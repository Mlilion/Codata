# 知识库删除清理:真机验证暴露的两个缺陷修复 — 设计

日期:2026-07-16
分支:feat/llm-wiki-knowledge-base
关联:`2026-07-16-knowledge-delete-cleanup-design.md`(原删除清理设计)

## 背景

删除清理功能(LLM 驱动)在本地 dev 桌面端真机验证时,一次性删除 3 条知识条目,暴露两个独立缺陷:

1. **模型选择错误**:headless ingest/cleanup 的 agent 跑在 `aliyun/deepseek-v4-flash`(一个弱的免费模型),而非用户配置的默认模型 `kaon/claude-opus-4-8`。弱模型收敛慢,cleanup agent 陷入 read/grep 循环,单会话堆到 100+ 轮、触发 context overflow,迟迟不执行删除/收尾动作。

2. **并发覆盖**:三个 cleanup agent 并发读写同一 `index.md`。各 agent 基于「自己开始时的 index 快照」修改后写回,后写覆盖先写。真机结果:已删条目「续订口径」在 index.md 中复活、其独有 source 页 `source-subscription-renewal.md` 复活、条目 `01KXMTPYP1HY` 连 `remove` 日志都没写就删了行。

### 根因定位

**缺陷 A** — `backend/app/session/prompt.py:285-312` 的模型选择级联:
```
model_id = request.model                      # ingest/cleanup 传 None
if not model_id and agent.model: ...          # build agent 无绑定模型
if not model_id:                              # 落到这里
    for _m in candidates:
        if _m.pricing.prompt == 0 and _m.pricing.completion == 0:
            model_id = _m.id; break           # ← 专挑第一个「免费(0/0)」模型
```
这条路径**从不查 `settings.default_model`**。而 `settings.default_model`(注释明确说"used by headless paths")已被 scheduler(`scheduler/executor.py:101`)和 channels(`channels/adapter.py:137`)通过共享 helper `app/provider/resolve.py::resolve_default_model(registry, settings)` 正确消费 —— ingest/cleanup 是**唯一漏用它的 headless 路径**。

**缺陷 B** — `2026-07-16-knowledge-delete-cleanup-design.md` 的「边界 2:MVP 不加锁」取舍。单条删除时冲突概率低,但「一次性删全部」把并发放大到极端,后写覆盖 index.md 现形。

## 目标

- ingest/cleanup 的 headless agent 使用用户配置的默认模型(与 scheduler/channels 一致)。
- 任一时刻只有一个 ingest/cleanup/reingest agent 写 wiki,消除 index.md 并发覆盖。
- 不改 `prompt.py` 的级联(零回归);默认模型未配置时行为回退到现状。
- 飞书/文件更新后可「重新加载」条目,先清后建、无陈旧残留,且对 done 条目有 UI 入口。

## 决策记录

- **缺陷 A**:在 ingest 层显式解析并传默认模型,**复用现成的 `resolve_default_model(registry, settings)` helper**(不自己读 `settings.default_model`,DRY)。不改 `prompt.py`。
- **缺陷 B**:模块级 `asyncio.Lock` 全局串行化,锁**只包住「跑 headless agent 改 wiki」段**,raw 快照读取留锁外。
- **缺陷 C(重新加载)**:语义 = 先清后建(cleanup 摸除旧页 → 重新 ingest),复用同一把锁与默认模型;done 条目加刷新图标入口。
- 锁是进程内的;desktop 单后端进程足够。

## 架构

### 缺陷 A:模型解析

```
DELETE/POST /knowledge → _schedule_ingest / _schedule_cleanup
   （已能拿到 request.app.state.settings）
   → 传 settings 给 ingest_entry / cleanup_entry
       → model_id, provider_id = resolve_default_model(provider_registry, settings)
       → PromptRequest(..., model=model_id, provider_id=provider_id)
```
- `resolve_default_model` 返回 `(model_id, provider_id)`;若 `settings.default_model` 为空,返回的 model_id 可能为 None/空 → `PromptRequest.model=None` → 回退到 `prompt.py` 现有级联(现状行为,不回归)。

### 缺陷 B:串行锁

```
ingest.py 模块级:
   _WIKI_AGENT_LOCK = asyncio.Lock()

ingest_entry / cleanup_entry:
   ...读 raw 快照 / 读 entry（锁外，无 wiki 写)...
   async with _WIKI_AGENT_LOCK:
       构造 prompt → _run_wiki_agent(跑 agent 改 wiki)→ 写回 DB 状态/删行
```
- 只有 wiki 读写段进锁;批量删除因此串行执行(慢但正确)。
- 失败路径不变:锁内异常由外层 try/except 捕获,`async with` 保证锁释放。

## 组件改动

### `backend/app/api/knowledge.py`
- `_schedule_ingest` / `_schedule_cleanup`:从 `st.settings` 取 settings,作为新增 kwarg `settings=st.settings` 传入 `ingest_entry` / `cleanup_entry`。

### `backend/app/knowledge/ingest.py`
- 顶部:`from app.provider.resolve import resolve_default_model`;`_WIKI_AGENT_LOCK = asyncio.Lock()`。
- `ingest_entry(..., settings=None)` / `cleanup_entry(..., settings=None)`:新增 `settings` 参数。
- 两函数内:`model_id, provider_id = resolve_default_model(provider_registry, settings) if settings else (None, None)`,填入各自 `PromptRequest(model=model_id, provider_id=provider_id, ...)`。
- 两函数内:把「构造 prompt → 跑 agent → 写回状态」段包进 `async with _WIKI_AGENT_LOCK:`。cleanup_entry 中「无 source 页跳过 agent、直接删 raw+行」的分支也应在锁内(它写 DB 行且可能删文件)。

## 缺陷 C(新需求):飞书/文件更新后的「重新加载」

### 问题
飞书文档(或本地文件)更新后,用户需要重新拉取并刷新知识库。现有能力:
- 后端 `POST /{entry_id}/reingest`(`api/knowledge.py:249`)把条目重置为 `pending` 并重跑 `ingest_entry`。
- 前端 `useReingestKnowledge` + 「重试」按钮,但**只在 `ingest_status === "failed"` 时显示**(`page.tsx:395`)—— 一个 `done` 条目在 UI 上没有任何刷新入口。

两个 gap:
1. **UI 缺入口**:done 条目看不到刷新按钮。
2. **语义错误(残留)**:现有 reingest 直接重跑 ingest,而 ingest_prompt 指令是「已存在页面用 edit **合并**,不要覆盖」(增量合并)。若飞书文档**删掉**了某段,旧内容会残留在 wiki 页 —— 与删除清理面对的同类「陈旧内容残留」问题。

### 决策:重新加载 = 先清后建(clean reingest)
「重新加载」语义 = **先跑 cleanup 摸除旧 wiki 页(复用刚实现的删除清理),再重新拉取原文 ingest**。青管子,无残留。

### 架构
```
POST /{entry_id}/reingest  (改造)
   → 若条目有 wiki 足迹(source 页存在)→ 置 ingest_status="pending" → _schedule_reingest
   后台 reingest_entry(id):
      async with _WIKI_AGENT_LOCK:      # 与 cleanup/ingest 同一把锁
         1. cleanup 阶段:跑 cleanup agent 摸除旧 wiki 页(不删 raw、不删 DB 行)
         2. ingest 阶段:重新拉取原文快照 + 跑 ingest agent 重建
      失败 → ingest_status="failed" + ingest_error
```
- **复用**:cleanup 逻辑与 ingest 逻辑都已存在;`reingest_entry` 是「cleanup 段 + ingest 段」的组合,共用 `_WIKI_AGENT_LOCK` 和 `resolve_default_model`(同样用默认模型)。
- **关键差异 vs 删除**:reingest 的 cleanup 段**不删 raw 快照、不删 DB 行**(条目要保留并重建);raw 会被 ingest 段的重新拉取覆盖。
- 为避免与纯删除的 `cleanup_entry` 混淆语义,cleanup 的「删 raw + 删行」收尾只属于删除路径;reingest 复用的是「摸除 wiki 页」这一段。实现上:把 cleanup 的「跑 agent 摸除 wiki」提取为可复用步骤,删除路径在其后追加「删 raw + 删行」,reingest 路径在其后追加「重新 ingest」。

### 前端
- `page.tsx`:对 `ingest_status === "done"` 的条目,在操作区加一个刷新图标按钮(`RefreshCw`),`onClick` 调用现有 `reingest(entry)`;飞书和本地文件条目都显示。
- 沿用现有 `useReingestKnowledge` hook(端点不变,仅后端行为从「增量 reingest」变为「先清后建」)。
- reingest 触发后条目进入 `pending`/活跃态,现有轮询照常刷新。

### 边界
- reingest 一个从未成功(无 source 页)的条目:跳过 cleanup 段,直接 ingest(等价于首次 ingest)。
- reingest 与删除互斥:若条目正 `deleting`,前端刷新按钮不显示(仅 done 显示);后端可加幂等保护(非 done/failed 时不重排)。

## 测试策略

沿用现有 `test_ingest_runner.py` / `test_cleanup_runner.py` 的 stub 模式(monkeypatch `run_generation`,`_resolve_data_dir` → tmp_path)。

- **模型选择(ingest & cleanup & reingest)**:传入带 `default_model="X"` 的 fake settings + stub `resolve_default_model` 或用真 registry;断言 stub `run_generation` 收到的 `req.model == "X"`、`req.provider_id` 正确。settings 为 None / 默认空时断言 `req.model is None`(回退)。
- **串行锁**:并发调度两个 `cleanup_entry`,用一个记录「进入/退出 `_run_wiki_agent` 时刻」的 stub,断言两次执行区间不重叠。
- **reingest(先清后建)**:stub 两段 agent,断言先跑 cleanup 段(摸除旧页)后跑 ingest 段(重建),且 **raw 快照与 DB 行保留**(不同于删除);无 source 页时跳过 cleanup 段。
- **前端**:tsc clean;done 条目渲染刷新按钮,点了调 reingest。
- **现有测试**:补 `settings` kwarg(默认 None 保持向后兼容,现有调用不传即回退)。
- **回归**:全 `tests/test_knowledge/` + `tests/test_api/ -k knowledge` 绿。

## 边界与非目标

- `resolve_default_model` 校验模型存在性由其自身/registry 负责;ingest 只消费其返回值。
- 锁进程内即可(desktop 单后端);不做跨进程/分布式锁。
- **非目标**:任务队列/排队 UI、ingest 取消、`prompt.py` 级联改造、跨进程锁。

## 真机复验

修复后重启 dev 桌面端,用配置好的强默认模型:导入 1 篇文档 → ingest 完成 → 删除 → 观察 agent 收敛(不再 context overflow)、正确删独有页、保留共享页、index.md 准确移除、行删除。再做一次「同时删 2 条」验证锁串行、index 无覆盖。
