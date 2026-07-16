# 知识条目删除的 LLM 驱动清理 — 设计

日期:2026-07-16
分支:feat/llm-wiki-knowledge-base

## 背景与问题

知识库(LLM wiki)的 ingest 流程用一个 headless build agent 把一份资料**整合进**本地 Markdown wiki:
生成 `source-<slug>.md` 摘要页、创建/更新实体页与概念页、用 `[[反向链]]` 互链、更新 `index.md` 分类索引、追加 `log.md`。

当前的删除接口 `DELETE /knowledge/{entry_id}`(`backend/app/api/knowledge.py`)只做了:
1. 删除 `raw/<id>.md` 原文快照
2. 删除 file 类型的上传文件
3. 删除 DB 行

**它完全没有清理 LLM 生成的 wiki 页面,也不更新 index.md。** 删除条目后:
- `wiki/source-<slug>.md`、被引用的实体/概念页会**残留为孤儿**;
- `index.md`(agent 检索的精度关键)仍指向已删除内容,agent 可能读到失效链接。

### 为什么不能机械删除

`KnowledgeEntry.wiki_pages` 字段记录的是「本次 ingest 期间创建或**编辑**过的页」(通过 before/after mtime-diff 得到),**不是「本条目独有的页」**。实测数据:

| 条目 | wiki_pages |
|------|-----------|
| 续订口径 | `log.md`, `source-subscription-renewal.md` |
| W2升级 | `index.md`, `log.md`, `renewal-rate.md`, `renewal-subtype.md`, `source-w2-order-upgrade.md`, `subscription-switch.md`, `subscription-tier.md` |
| (条目3) | `index.md`, `log.md`, `source-w2-order-upgrade.md` |

可见:
- `log.md` / `index.md` 被**每条**记录 touch(机械删是灾难);
- `source-w2-order-upgrade.md` 被两条记录「认领」;
- 概念页(`renewal-rate`、`subscription-tier`…)被多篇来源通过 `[[反向链]]` 共享引用。

因此**不存在安全的机械删除法**,需要 LLM 判断哪些内容是「该条目独有、可安全删除」的。

## 目标

删除一个知识条目时,对称于 ingest,用一个 headless build agent 把该资料从 wiki 中**干净地摘除**:删独有的 source 页、清理孤儿引用/页面、从 index 移除相关行并重建、记录删除日志;完成后再真正删除 DB 行与 raw 快照。

## 决策记录

- **清理方式**:LLM 驱动清理(与 ingest 对称),而非纯机械删除。
- **删除 UX**:显示「清理中」状态 —— 清理期间保留 DB 行(status=`deleting`),清理完成后行才消失。
- **失败处理**:清理失败则保留条目并标记错误(`ingest_status="failed"` + `ingest_error`),用户可重试删除。
- **index 重建**:同一个 cleanup agent 一并重建 index(不分两步)。
- **并发(ingest 中点删除)**:不加锁,允许(MVP)。

## 架构

对称于 ingest —— ingest 用 headless build agent 把资料**整合进** wiki,删除用 headless build agent 把资料**从** wiki 摘除。

```
用户点删除
  → DELETE /knowledge/{id}
      ├─ 条目不存在 → 404
      ├─ 已是 deleting 态 → 幂等返回(不重复调度)
      ├─ file 类型上传文件:确定性删除(保留现有逻辑)
      ├─ 置 ingest_status = "deleting"、ingest_error = ""(不删 DB 行、不删 raw 快照)
      ├─ 触发后台 cleanup 任务(fire-and-forget)
      └─ 立即返回条目(status=deleting)—— 请求不阻塞

后台 cleanup_entry(id):
  1. 读条目,拿 raw_path / wiki_pages / title;从 wiki_pages 筛出 source-*.md 作为清理锚点
  2. 若无 source 页(从未 ingest 成功):跳过 agent,直接删 raw 快照 + DB 行
  3. 否则跑 headless build agent(cleanup prompt):
       - 删该条目独有的 source-<slug>.md
       - grep 反向链判断孤儿:仍被其他资料引用的页保留,只删本资料专属段落;孤儿页整页删除
       - 从 index.md 移除相关行(一并重建索引)
       - log.md 追加删除记录
  4. agent 成功 → 删 raw/<id>.md 快照 + 删 DB 行(真正消失)
  5. agent 失败/超时 → ingest_status="failed"、ingest_error=清理失败原因,保留 DB 行(可重试)
```

前端已有轮询(有 active 状态时每 3s)+ 状态标签机制,`deleting` 直接接入:显示「清理中」,清理完条目从列表消失。

## 数据模型

**无 schema 变更、无 migration。** 复用 `KnowledgeEntry.ingest_status`:
- 新增取值 `"deleting"`(清理进行中);
- 失败沿用 `"failed"` + `ingest_error`(写入清理失败原因)。

## 组件

### cleanup_prompt.py(新)

对称于 `ingest_prompt.py`,导出 `build_cleanup_prompt(entry, source_page, wiki_dir_abs) -> str`。

核心防线是**用 grep 反向链数引用**判断孤儿,而不是靠 `wiki_pages` 字段(该字段含共享页,不可靠)。

Prompt 骨架:

```
你是知识库维护助手。一份资料被移除,请把它从 wiki 中干净地摘除。

## 被移除的资料
- 标题:{title}
- entry_id:{entry_id}
- 它的 source 摘要页:{source_page}

## wiki 目录
{wiki_dir_abs}

## 你的步骤(先 read 判断,再 write/edit/删除)
1. 读该资料的 source 页,了解它引入了哪些实体/概念页。
2. 删除这个 source 页(它是该资料独有的)。
3. 对它引用过的每个实体/概念页,用 grep 检查是否还有其他 source 页/页面引用([[反向链]]):
   - 仍被其他资料引用 → 保留,只删除其中专属于本资料的段落/矛盾标注。
   - 已无任何其他引用(孤儿) → 删除整页。
4. 更新 index.md:移除已删页面对应的行;保留页的摘要若因删段而变化则同步更新。
5. log.md 末尾追加:`## [{entry_id}] remove | {title}`。
6. 绝不删除 index.md / log.md 本身,不动与本资料无关的页面。

只操作本 wiki 目录。完成后简述你删除/保留了哪些页面及理由。
```

### ingest.py(改)

新增 `cleanup_entry(entry_id, *, session_factory, provider_registry, agent_registry, tool_registry, index_manager=None)`:

- 与 `ingest_entry` 一样 fire-and-forget、**绝不让异常传播**(失败记为 `ingest_status="failed"`)。
- 复用 ingest 已有的「跑 headless build agent」逻辑(抽出共用私有函数,或直接复用 `run_generation` 调用块):构造 `PromptRequest(agent="build", workspace=wiki_root)`、跑 `run_generation`、删除 throwaway session。
- 状态:进入 `cleanup_entry` 时条目已被 `delete_knowledge` 置为 `deleting`,清理全程保持 `deleting`(不改回 processing),终态只有两种:成功=删行、失败=`failed`。
- 步骤:读条目 → 无 source 页则跳过 agent 直接删 raw + DB 行 → 否则跑 cleanup agent → 成功删 raw 快照 + `delete_by_id` DB 行 → 失败置 `failed` + `ingest_error`。

### api/knowledge.py(改)

`delete_knowledge` 改为:
1. 查条目,404 保持。
2. 幂等:若 `ingest_status == "deleting"`,直接返回条目,不重复调度。
3. file 类型上传文件删除(保留现有逻辑)。
4. 置 `ingest_status = "deleting"`、`ingest_error = ""`,flush(**不再当场删 raw 快照、不再删 DB 行**)。
5. `_schedule_cleanup(request, entry_id)`(复用 `_schedule_ingest` 的 `asyncio.create_task` 模式)。
6. 返回 `_entry_to_dict(entry)`(status=deleting)。

### 前端

- `use-knowledge.ts`:`ingest_status` 类型联合加 `"deleting"`;轮询用的 active 状态集合加 `"deleting"`;`useDeleteKnowledge.onSuccess` 保持 `invalidateQueries`(条目以 deleting 态回列表,靠轮询直到消失)。
- `page.tsx`:`INGEST_STATUS_LABEL` 加 `deleting: "清理中"`;`ACTIVE_STATUSES` 加 `"deleting"`;删除按钮在 `deleting` 时禁用。

## 边界情况

1. **从未 ingest 成功就删**(无 source 页):`cleanup_entry` 跳过 agent,直接删 raw 快照 + DB 行。
2. **ingest 中点删除**:MVP 不加锁。照常置 `deleting` 并调度 cleanup;两个后台 task 串行概率高,冲突概率低。
3. **重复点删除**:前端按钮在 `deleting` 禁用;后端 delete 幂等(见上)。
4. **agent 误删共享页**:prompt 步骤 3 的 grep 反向链检查是主防线;log.md 记录删除理由便于事后排查;不做自动回滚(YAGNI)。

## 错误处理

- `cleanup_entry` 全程 try/except,失败写 `ingest_status="failed"` + `ingest_error`,保留 DB 行与 raw 快照,用户可重试删除。
- 删除 throwaway session 失败:best-effort,只记 warning,不影响清理结果(沿用 ingest 的处理)。

## 测试策略

全部用 agent stub(monkeypatch `run_generation`),不跑真实 LLM;沿用 `test_ingest_runner.py` 的 `_resolve_data_dir` monkeypatch 到 `tmp_path` 的模式。

- **cleanup_prompt**:快照/关键字断言(含 entry_id、source_page、「grep 反向链」「绝不删除 index.md/log.md」等关键约束)。
- **cleanup_entry 成功路径**:agent stub 生成预期文件状态 → 断言 raw 快照删除 + DB 行删除。
- **cleanup_entry 失败路径**:agent stub 抛错 → 断言 `ingest_status="failed"` + 行保留 + raw 快照保留。
- **cleanup_entry 无 source 页**:断言跳过 agent、直接删 raw + DB 行。
- **API delete_knowledge**:断言返回 status=deleting 且行仍在、后台任务被调度;重复调用幂等。

## 非目标(YAGNI)

- 清理的并发锁 / ingest 取消机制。
- 误删的自动回滚 / 版本快照。
- 多知识库粒度(沿用现有全局单一 wiki)。
