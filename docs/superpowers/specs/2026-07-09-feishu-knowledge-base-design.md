# Codata 飞书文档知识库 —— 设计文档

- 日期:2026-07-09
- 状态:设计(brainstorming 产出,待用户评审)
- 落地位置:**现有桌面端内嵌后端**(非独立后端)

---

## 1. 目标与核心理念

用户希望把自己/团队沉淀在**飞书**里的文档,变成 data agent 回答时可用的背景知识。

**核心流程(用户主导、按需读取):**

1. 用户把飞书文档**链接手动添加**进 Codata 的知识库管理页(显式圈定知识范围);
2. data agent 回答业务问题时,通过**飞书官方 MCP 按需读取**这些已登记文档的正文;
3. 内容进入上下文,回答附带来源链接。

**关键取舍:不做 RAG。** 经核实(见 §7),目标场景是**小知识库(几个空间 / 几十篇)**,文档少到 agent 几乎可全读,向量召回价值发挥不出来,上向量库/AnythingLLM 属于过度工程。改为"链接管理 + MCP 实时读取":

- ✅ 无摄取管线、无 embedding、无向量库、无同步任务;
- ✅ 内容永远实时(每次读飞书最新版,无快照延迟);
- ✅ 知识范围由用户显式掌控(加了哪些链接就读哪些);
- ✅ 读取用飞书官方 MCP,连飞书 API 调用都不用自研。

将来文档量涨到"全读塞爆上下文",再在 `read_knowledge` 内部插入 RAG 层(那时才需要向量库),管理层与 agent 层不用改。

---

## 2. 现状认知(基于代码核实)

- **落地在现有桌面端内嵌后端**(`backend/app/`,SQLite)。独立 `codata-server` 后端([[2026-07-08-codata-server-blueprint]])尚未建,本功能不等它。数据模型预留 `user_id`/`scope`,将来可平滑迁移为团队共享。
- 复用三套现成机制:
  - **连接器机制** `backend/app/connector/`(`ConnectorRegistry`)—— 接飞书 MCP,和 datasage 同款;
  - **builtin tool 机制** `backend/app/tool/builtin/` —— 新增 `read_knowledge`;
  - **model + API + 管理页** —— 仿 `skills` / `connectors` 现有实现。
- **飞书 MCP 定位**复用 `backend/app/mcp/datasage_client.py` 的做法:按暴露的工具名定位 MCP client(服务器名用户可配),而非固定名。
- 澄清:现有 `channels/feishu.py` 是**消息通道**,不是文档 API,与本功能无关。

---

## 3. 整体架构

```
① 知识库管理(自建)         ② 飞书 MCP 连接器(接现成)      ③ agent 按需读取(新工具)
┌──────────────────┐       ┌────────────────────────┐     ┌────────────────────────┐
│ 前端 /knowledge   │       │ larksuite/lark-openapi- │     │ builtin: read_knowledge │
│ · 贴飞书链接 添加 │       │ mcp(官方)             │     │ · 无参 → 列已登记文档   │
│ · 列表/备注/启停/删│──注册─▶│ 注册进 ConnectorRegistry│◀────│ · 传 id → 读该文档正文   │
│ 后端 api/knowledge│       │ · docx rawContent(正文)│     │ · 返回内容 + 来源链接   │
│ + KnowledgeEntry表│       │ · wiki 遍历 / search    │     │ (复用 datasage_client   │
│ (SQLite)         │       │ · OAuth(user token)   │     │  同款 MCP 定位)         │
└──────────────────┘       └────────────────────────┘     └────────────────────────┘
        │                                                            ▲
        └──── 清单(标题+备注)每轮注入 data agent 上下文 ───────────┘
```

---

## 4. 组成部分详细设计

### 4.1 知识库管理(全新,主体工作量)

**数据模型** — 新增 `backend/app/models/knowledge_entry.py`(仿 `analysis_memory.py` 风格):

```
KnowledgeEntry
  id            主键(ulid)
  user_id       预留多用户,现为 null(单用户全局)
  scope         预留个人/团队,现默认个人
  title         文档标题(添加时可选调飞书 API 拉取,或用户填/URL 兜底)
  feishu_url    用户粘贴的原始飞书链接
  feishu_token  从 URL 解析出的 doc/wiki token(读取时用)
  doc_type      docx / wiki / sheet / bitable(从 URL 判断)
  note          用户备注(为什么加、讲了什么 —— 也用于清单注入让 agent 判断相关性)
  enabled       是否启用(临时关闭不删)
  created_at, updated_at
```

**URL 解析**(关键小逻辑):从飞书链接解析 doc 类型与 token。形态示例:
- `https://xxx.feishu.cn/docx/{token}` → docx
- `https://xxx.feishu.cn/wiki/{token}` → wiki
- `https://xxx.feishu.cn/sheets/{token}` → sheet
- `https://xxx.feishu.cn/base/{token}` → bitable
解析失败则报错提示用户链接格式。

**后端 API** — 新增 `backend/app/api/knowledge.py`(仿 `api/connectors.py`),在 `api/router.py` 挂载:
- `GET /api/knowledge` — 列出所有登记文档
- `POST /api/knowledge` — body `{feishu_url, note?}`;解析 URL,可选调飞书 API 拉标题,落库
- `PATCH /api/knowledge/{id}` — 改 note / enabled
- `DELETE /api/knowledge/{id}` — 删除

**前端管理页** — 新增 `frontend/src/app/(main)/knowledge/page.tsx`(仿 `skills/page.tsx`):
- 顶部:贴链接输入框 + 备注 + "添加"按钮
- 列表:标题 / 类型徽标 / 备注(可编辑) / 启停开关 / 删除
- 空态引导:"把飞书文档链接添加进来,分析时 AI 就能参考它们"
- 导航入口:`components/codata/codata-sidebar.tsx` 加"知识库"项

### 4.2 飞书 MCP 连接器(接现成)

- 把官方 `larksuite/lark-openapi-mcp` 作为一个连接器注册进 `ConnectorRegistry`(与 datasage 同款接入)。可作为 seed 连接器预置(仿 `data/connectors.json` 里 datasage 的做法),用户填授权即可启用。
- **授权**:飞书 OAuth,`user_access_token`(读该用户有权限的文档)。lark-mcp 自带 `login` 流程。
- 启用后,飞书的 `docx.v1.document.rawContent`(读正文纯文本)、`wiki` 遍历/搜索等成为 agent 可发现的 MCP 工具。
- 读取粒度:docx rawContent 返回纯文本(`\n` 分隔),对"喂进上下文"足够;需要结构可另调 blocks 接口(首期不必)。

### 4.3 read_knowledge builtin 工具(新)

新增 `backend/app/tool/builtin/read_knowledge.py`,注册进 agent 工具集:

```
read_knowledge(entry_id?: str)
  · 无 entry_id → 返回已登记文档清单 [{id, title, note, doc_type}]
  · 有 entry_id → 从 KnowledgeEntry 取 feishu_token,
      经飞书 MCP client(复用 datasage_client 同款定位:按飞书工具名找到 client)
      调 rawContent 读正文 → 返回 {title, content, source_url}
  · 飞书未授权/读取失败 → 返回明确错误供 agent 自处理
```

- 找飞书 MCP client 的逻辑:仿 `datasage_client.find_execute_sql_client`,改为按飞书文档工具名(如 `docx...rawContent`)定位,服务器名用户可配。
- 只读已登记文档(不让 agent 漫游整个飞书),范围受 KnowledgeEntry 约束。

### 4.4 agent 上下文注入(清单注入 + 正文按需读)

- **清单注入(每轮)**:构建 `<knowledge-base>` 段,列出所有 `enabled` 文档的标题+备注(清单短,几十条可全量注入),注入 data agent 的 system prompt。仿现有 `memory/injection.py` 的 `build_*_section` 模式。
- **正文按需读**:agent 看到清单里相关的条目,再调 `read_knowledge(id)` 读正文(正文长,不能全塞)。
- **agent 引导**:在 `backend/app/agent/prompts/data.txt` 加一段:"回答业务问题前,先看 `<knowledge-base>` 清单有无相关文档;有则用 `read_knowledge(id)` 读取正文作为权威背景,并在回答中注明来源(飞书链接)。"

---

## 5. 数据流

**添加知识:**
```
用户贴飞书链接 → POST /api/knowledge → 解析 URL(token/type)
  → (可选)飞书 API 拉标题 → 存 KnowledgeEntry → 管理页列表刷新
```

**使用知识:**
```
用户在 Codata 提问
  → 每轮:enabled 文档清单(标题+备注)注入 <knowledge-base>
  → agent 判断某条相关 → read_knowledge(id)
  → 经飞书 MCP 读该文档 rawContent → 内容进上下文
  → agent 回答,附来源飞书链接
```

---

## 6. 实施顺序(建议)

1. `KnowledgeEntry` model + 迁移(自动建表)+ URL 解析工具函数;
2. `api/knowledge.py` CRUD + 挂载路由;
3. 前端 `/knowledge` 管理页 + sidebar 入口(仿 skills 页);
4. 飞书 `lark-openapi-mcp` 作为 seed 连接器 + 授权打通;
5. `read_knowledge` builtin 工具(复用 datasage_client 定位法);
6. 清单注入 `build_knowledge_section` + `data.txt` 引导;
7. 端到端验证:加一篇飞书文档 → 提问 → agent 读取并引用。

---

## 7. 关键取舍与依据(核实结论)

- **飞书 MCP 不能替代 RAG,但本场景不需要 RAG**:核实(官方 `lark-openapi-mcp` + 社区 `feishu-mcp`/`clawdbot-feishu`)确认飞书搜索是**关键词级**(query ≤50 字、只返回标题/URL 不返回正文、无语义),擅长"精确读取"。小知识库靠"清单注入 + 按需读取已登记链接"即可,不依赖语义搜索。
- **读取买现成、管理自己做、编排薄**:读取 = 飞书官方 MCP;管理 = 原生 UI+数据;编排 = 一个 builtin 工具 + 一段清单注入。
- **升级路径清晰**:文档变多时,`read_knowledge` 内部可加"向量召回相关条目"层(引入向量库/AnythingLLM),对外接口和管理页不变。

---

## 8. 开放问题(留待实现)

- 飞书 OAuth 应用注册与所需 scope(`docx:document:readonly`、`wiki:wiki:readonly` 等)。
- `lark-openapi-mcp` 用 stdio 还是 SSE 接入(桌面端内嵌后端环境下的运行方式)。
- 添加链接时是否同步调飞书 API 拉标题(需已授权)——还是先存 URL、标题懒加载。
- wiki 空间链接:是登记整个空间(读取时遍历)还是仅单篇。首期建议仅单篇文档,空间遍历后续加。
- 清单注入的规模上限(超过 N 条时改为让 agent 主动列清单,避免注入过长)。
