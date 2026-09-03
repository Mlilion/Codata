# Codata & CodataAdmin 历史功能盘点（按主题拆解）

日期：2026-09-02  
定位：对 Codata（桌面 data agent，v1.1.23）与 CodataAdmin（语义平台 + 管理后台）已落地能力的主题式归类盘点，为后续规划与对外汇报提供功能清单基线。

---

## 一、语义模型的建设（CodataAdmin 为主体）

语义模型是 data agent 可信问数的根基。CodataAdmin 已建成完整 6 层语义体系，从物理目录到业务实体、模型关系、维度指标、知识库形成闭环，并配套治理与检索能力。

### 1.1 六层语义模型架构

**功能描述**：  
完整实现从物理层到知识层的 6 层语义模型，支撑"口径即资产"的企业级数据治理。

**核心模块**：
- **L1 物理目录层（Catalog）**：库/表/列/分区元数据采集，支持从 DataSage 同步或直连数仓扫描 `information_schema`。
- **L2 业务层（Entity & Field）**：业务实体 + 业务字段，物理列的业务化封装，含枚举、可见性、计算表达式，通过 `physical_table_id`/`physical_column_id` FK 软挂钩物理层。
- **L3 模型层（Join）**：实体间 JOIN 关系声明（有向图），支撑跨表分析与查询编译，含 relationship（many_to_one/one_to_many）、join_type、on_expr。
- **L4 维度层（Dimension）**：分析视角 + 维度↔字段绑定（`sem_dimension_binding`），支持主/副绑定。
- **L5 指标层（Indicator）**：业务度量 + 权威口径 SQL（原子/派生/复合，多口径），含主实体、可用维度白名单、引用字段。
- **L6 知识层（Knowledge）**：业务背景/口径由来/使用说明/避坑/查询范式（Markdown + frontmatter），通过 `sem_knowledge_ref` 挂载到任意语义实体。

**价值**：
- 策展与采集分离：L1 机器采集可重刷，L2-L6 人工策展有审核状态机，物理与语义解耦。
- 支撑口径可信：agent 查询走权威口径 SQL（L5），不自己编 SQL，根除幻觉。

**技术实现**：
- 后端：FastAPI + SQLAlchemy + MySQL，14 个 `module_semantic` 子模块。
- 前端：Vue3 + Element Plus，语义中心统一入口，含物理目录、业务实体、语义模型、JOIN 关系、维度、指标、知识库 7 个管理页。

---

### 1.2 语义模型发布与快照管理

**功能描述**：  
语义模型采用状态机（草稿→待审→发布→归档）+ 发布快照机制，保证 agent 查询时取到的是**已审核的稳定版本**，而非实时编辑态。

**核心能力**：
- **发布快照（Release）**：一键发布生成 `sem_model_release` 快照，含完整模型树、完整度灯状态、version 递增。
- **发布守卫（`snapshot_audit`）**：发布时自动校验口径 SQL 是否引用了模型未声明的列，拦截"物理漂移导致的口径失效"。
- **完整度灯（Completeness）**：实体/字段/指标/维度按规则判红黄绿（如实体未绑物理表 🔴、指标无已审核口径 🔴、`physical_table_id` 指向已失效 cat_table 即 orphan 🔴），缺失项可"去修复"跳转。

**价值**：
- agent 只查发布快照，编辑态对查询不可见，避免"改一半就被用了"。
- 完整度灯让治理可视化，红灯即阻塞发布，倒逼补齐。

**技术实现**：
- `model/service.py`：`_load_tree_data` / `_build_tree` / `publish` / `_compile_snapshot`。
- `model/completeness.py`：规则引擎判灯。

---

### 1.3 口径治理：优先命中 + 自造标红 + 口径声明随结果返回

**功能描述**：  
分析结果必须带口径背书，区分"权威口径"与"自造 SQL"，让用户可判断可信度。

**核心能力**：
- **口径优先命中**：agent 问数链路强制走 `search_semantic` → `get_model_context` → `query_indicator`，优先召回权威口径；只有探索场景才走 `execute_sql` 裸 SQL 旁路。
- **自造 SQL 标红**：`execute_sql` 返回的结果**不带 `caliber` 声明**，前端/agent 必须标注"未经口径审核"。
- **`caliber` 口径声明**：`query_indicator` 返回结构化口径元信息（指标全名/单位/口径定义/数据层/模型版本/warnings），随结果卡一并展示。

**价值**：
- 把"这个数字从哪来、可不可信"显式化，避免错误口径被当权威。
- 口径优先是"压住幻觉"的关键一环（§2.5.1 roadmap 表：SQL 生成 = 无幻觉，因为取 `sql_text` 填占位符，不是 LLM 生成）。

**技术实现**：
- 主链路四工具顺序（semantic-mcp.md §二）。
- `caliber` 字段随 `query_indicator` 返回。

---

### 1.4 上游变更治理：catalog 同步 + 绑定失效待办

**功能描述**：  
物理表结构变动（列删除/改名/表删除）会导致语义层绑定失效。上游变更治理自动检出失效项，进待办逐条人工处理，避免口径 SQL 静默失败。

**核心能力**：
- **Catalog 同步**：从 DataSage 或直连数仓同步最新元数据，按 `(table_id, name)` upsert，消失的列/表软删，软删行复活而不新插（避免自增主键复用导致绑定错乱）。
- **变更检出**：同步后自动检出三级变更：
  - `bound`（绑定失效）：`sem_field.physical_column_id` 指向已失效列，`sem_entity.physical_table_id` 指向已失效表。
  - `sql_ref`（口径 SQL 失效）：指标实现的 SQL 引用了已失效列/表。
  - `table_only`（仅表相关）：表层面变更，通常只需确认。
- **待办处理**：进 `sem_upstream_change` 表，前端"上游变更"页逐条处理；`bound`/`sql_ref` 级进 `readiness` blocker，不处理完 `ready` 不会转 true。

**价值**：
- 把"物理漂移导致语义失效"从隐患变成显式待办，治理可闭环。
- 避免"查询跑了但因引用不存在的列而静默返回空/报错，用户不知为何"。

**技术实现**：
- `catalog/upstream_change.py` + `readiness` blocker。
- 前端语义中心「上游变更」页 + 忽略必写原因（关闭后不可重复关闭，防抹掉决策历史）。

---

### 1.5 语义检索：别名/全文/向量三路 + RRF + 同义词治理

**功能描述**：  
用户自然语言问法（"6月订阅收入"）→ 召回对应指标 code，是问数链路的第一跳。检索质量直接决定"能不能找对指标"。

**核心能力**：
- **三路检索 + RRF 融合**：
  - 别名精确匹配（`sem_indicator.aliases` JSONB）
  - 全文分词匹配（PostgreSQL + jieba）
  - 向量语义匹配（pgvector + OpenAI 兼容 embedding 端点）
  - RRF（Reciprocal Rank Fusion）融合三路结果
- **同义词治理**：query 日志记录用户问法 + 召回结果，管理端可批量采纳为别名或标记拒答原因，形成闭环。
- **`did_you_mean`**：零命中时返回字面相近指标，但 agent 必须 `get_model_context` 核对口径，不可直接用相近指标凑数。

**价值**：
- 长口语问法召回弱是已知限制，三路检索 + 别名沉淀是主要缓解手段。
- 同义词治理让检索质量可持续优化。

**技术实现**：
- 副库：PostgreSQL + pgvector，`semantic_retrieval_enable=true`。
- 后端：`semantic-retrieval-pg-design`、`init-retrieval` 命令建表。
- 前端：语义中心「同义词治理」页，含 query 日志、候选、零召回、按调用方筛选。

---

## 二、Data Agent 框架搭建（Codata 为主体）

Codata 是桌面端 data agent，已形成完整的"自然语言问数 → SQL 执行 → 结果可视化 → 沉淀为看板/报告"闭环，并配套多 Agent 编排、MCP 连接器、调度器、技能、插件等基础设施。

### 2.1 桌面端分析闭环

**功能描述**：  
桌面 App（Tauri shell + Next.js 前端 + 内嵌 FastAPI 后端），从问题到结论的完整链路。

**核心流程**：
1. **自然语言问数**：用户输入问题，agent 解析意图。
2. **表/指标发现**：经 MCP 调用 CodataAdmin 的 `search_semantic`，召回指标 code。
3. **SQL 生成执行**：
   - 优先走 `query_indicator`（权威口径，系统填参）
   - 探索场景走 `execute_sql`（自造 SQL，标红）
4. **结果卡 + 图表**：`run_query` 返回结构化结果（含 `caliber` 口径声明），前端渲染为表格/图表/SQL 标签页。
5. **沉淀为看板/报告**：结果卡可 pin 到 dashboard，或生成 HTML 数据报告（`data-report-html` skill）。

**价值**：
- 桌面端降低问数门槛：非 SQL 用户也能自然语言问数。
- 本地优先：会话/看板存本地，数据不出域（仅查询经 CodataAdmin MCP）。

**技术实现**：
- 前端路由：`/c`（对话）、`/dashboard`（看板）、`/experts`（专家团）、`/knowledge`（知识库）等。
- 后端 agent 系统：`backend/app/agent/{build,plan,explore,general}`，工具系统 `tool/builtin/run_query.py`。

---

### 2.2 专家团多 Agent 编排

**功能描述**：  
复杂任务（如"对比 Q1 和 Q2 各渠道 GMV，分析差异原因"）拆解为子任务并行/串行执行，由多个专家 agent 协作完成。

**核心能力**：
- **Agent 角色**：build（建模）、plan（规划）、explore（探索）、general（通用）。
- **任务分发**：主 agent 拆解任务 → 子 agent 并行跑 → 汇总结果。
- **上下文共享**：专家团可访问会话历史、看板、知识库。

**价值**：
- 并行提速：多个维度的分析可同时跑。
- 专业化：不同角色擅长不同任务（探索 vs 建模 vs 规划）。

**技术实现**：
- `backend/app/agent/` 四个专家目录 + `prompts/` 提示词。
- 编排逻辑在主 agent。

---

### 2.3 MCP 连接器 + 工具调用链路

**功能描述**：  
Codata 作为 MCP client，连接 CodataAdmin（语义层）、DataSage（数仓）等 MCP server，调用远程工具能力。

**核心能力**：
- **已对接工具**（`datasage_parser.py` 的 `KNOWN_TOOLS`）：
  - CodataAdmin：`list_models` / `search_semantic` / `get_model_context` / `query_indicator` / `execute_sql`
  - （可扩展）：DataSage、自建 MCP server
- **工具调用链路**：agent 决策 → MCP client 序列化请求 → Streamable HTTP → MCP server 执行 → 返回结构化结果。
- **P0「首次可用」能力**（roadmap §1.1）：
  - `run_query` 结果行回喂 LLM：结果预览（前 50 行/4000 字符）喂给 agent 做后续推理。
  - 口径强制 + 数量级 sanity-check：检查结果数量级是否合理（如 GMV 不该是个位数）。

**价值**：
- 解耦：Codata 不自建语义层，复用 CodataAdmin 能力。
- 可扩展：新增 MCP server 不改 Codata 核心。

**技术实现**：
- `backend/app/mcp/datasage_parser.py`：MCP client 实现。
- `backend/app/tool/builtin/run_query.py`：结果行回喂 + 格式化。

---

### 2.4 调度器 + 技能（Skills）

**功能描述**：  
定时/触发式任务 + 可复用的分析技能，降低重复工作。

**核心能力**：
- **调度器**：APScheduler 后端，支持 cron 定时、一次性任务、周期任务。
- **技能（Skills）**：可复用的 prompt + 工具链组合，如 `data-report-html`（生成 HTML 报告）、自定义 SQL 模板等。
- **前端入口**：`/automations`（自动化）、`/skills`（技能管理）。

**价值**：
- 自动化：每日定时跑核心指标报告。
- 复用：常用分析范式封装为 skill，一键调用。

**技术实现**：
- 后端：`backend/app/scheduler/`。
- 前端：`/automations` / `/skills` 路由。

---

### 2.5 插件与扩展能力

**功能描述**：  
开放架构，支持自定义插件扩展 Codata 能力。

**核心能力**：
- **插件入口**：`/plugins` 路由。
- **扩展点**：自定义工具、自定义 agent、自定义 UI 组件。

**价值**：
- 社区/企业内部可贡献插件。
- 不改 Codata 核心即可扩展。

**技术实现**：
- `backend/app/plugin/` + 前端 `/plugins` 路由。

---

## 三、知识体系自闭环（Codata + CodataAdmin 协作）

知识不只是"存文档"，而是"可被 agent 主动调用、可沉淀、可验证、可迭代"的资产。

### 3.1 知识库（Knowledge）+ 交叉引用

**功能描述**：  
CodataAdmin L6 知识层，存储业务背景/口径由来/使用说明/避坑/查询范式，通过 `sem_knowledge_ref` 挂载到指标/实体/维度等语义资产。

**核心能力**：
- **知识类型**（`knowledge_type`）：
  - `background`（背景解释）
  - `usage`（使用说明）
  - `caveat`（避坑）
  - `query_pattern`（查询范式）
  - `glossary`（术语）
- **交叉引用**（`sem_knowledge_ref`）：知识 → 语义实体（entity/field/dimension/indicator/knowledge），`ref_type` 含 describes / howto / caveats / contradicts。
- **`usage_mode`**：always（必用）/ auto（可用）/ never（禁用），控制 agent 是否主动带上。
- **`representative_sql`**：示例/推荐 SQL，使用说明类常用。

**价值**：
- agent 拿到指标时，通过 `knowledge_ref` 反查其 howto/caveats 类知识，把"怎么用、别踩什么坑"一并带进上下文，避免生成错误 SQL。
- 知识与语义资产强绑定，不是散在 wiki 里的孤岛。

**技术实现**：
- 后端：`module_semantic/knowledge/` + `sem_knowledge` / `sem_knowledge_ref` 表。
- 前端：语义中心「知识库」页，Markdown 编辑 + frontmatter。

---

### 3.2 Codata 本地知识库 + 记忆

**功能描述**：  
Codata 桌面端有独立的本地知识库 + 记忆系统，存储用户自己的分析笔记、SQL 片段、结论。

**核心能力**：
- **知识库**：`/knowledge` 路由，存储个人分析知识（非团队共享，本地优先）。
- **记忆（Memory）**：agent 会话中的关键信息（用户偏好、常用指标、历史结论）可沉淀为记忆，后续对话自动带上。

**价值**：
- 个人知识积累，不依赖团队共享。
- 记忆让 agent 越用越懂用户。

**技术实现**：
- 前端：`/knowledge` 路由。
- 后端：本地存储（SQLite / 文件）。

---

### 3.3 裸 SQL 审计 + 调用方留痕

**功能描述**：  
`execute_sql` 旁路（agent 自己写 SQL）的每次调用都会写进审计日志，含 SQL 原文、涉及的表、调用方、成败、耗时。

**核心能力**：
- **90 天留痕**：`sem_raw_sql_log` 表，保留 90 天（短于 query 日志的 180——审计含 SQL 原文，不宜久留）。
- **被守卫拒绝的调用也记**：`permission_denied` 反复出现说明有人在试探写操作，那才是审计里最该被看见的部分。
- **按调用方筛选**：query 日志记录 `caller`（MCP token 名），治理时可定位"是哪个 agent/脚本在这么问"。
- **独立权限**：`module_semantic:rawsqllog:list`，不含在普通 querylog 权限里（审计含 SQL 原文，能看它等于能看到查询意图与表结构）。

**价值**：
- 事后追溯：谁在什么时候查了什么表、SQL 是什么。
- 治理可见：自造 SQL 的使用频率、涉及的表、是否被拒，一目了然。

**技术实现**：
- 后端：`module_semantic/rawsqllog/` + `2026-08-05-semantic-raw-sql-log.sql` 补丁。
- 前端：语义中心「同义词治理」→「裸 SQL 审计」Tab。

---

### 3.4 同义词治理 + 检索质量闭环

**功能描述**：  
用户问法 + 召回结果记录到 query 日志，管理端可批量采纳为别名或标记拒答原因，检索质量持续优化。

**核心能力**：
- **Query 日志**：记录用户问法、召回的指标 code、时间窗、调用方。
- **候选采纳**：管理端「同义词治理」页展示高频问法，可批量采纳为 `sem_indicator.aliases`。
- **零召回标注**：问法零命中时记录 `rejected`，可标注拒答原因（不在覆盖范围 / 服务端故障）+ `did_you_mean` 建议。
- **按调用方筛选**：脚本写死的措辞 vs 真人提问，采纳标准不同；单个 token 泄露可单独吊销。

**价值**：
- 闭环：用户问 → 记录 → 治理 → 采纳 → 下次召回更准。
- 可观测：哪些问法召回弱、哪些调用方问得多。

**技术实现**：
- 后端：`module_semantic/querylog/` + query 日志表。
- 前端：语义中心「同义词治理」页。

---

### 3.5 就绪自检（Readiness）+ Blockers

**功能描述**：  
一个端点回答"这套语义平台 + data agent 现在能用吗"，列出所有阻塞项（blockers），治理可闭环。

**核心能力**：
- **检查项**：
  - 检索副库：启用 / 可达 / 已建表 / 向量列宽与维度一致
  - 已发布模型数 > 0
  - 索引新鲜度：模型已发 v3 而索引仍 v2 会报出来
  - 数仓连接：真跑一次 `SELECT 1`（5 秒短超时）
  - MCP：启用但因缺 token 未挂载会报出来
  - 上游变更待办：`bound` / `sql_ref` 级的 `pending` 条数（`table_only` 不计入）
- **返回**：`ready: true/false` + `blockers: []` 数组。

**价值**：
- 部署时验收标准：`ready: true` + `blockers: []` 即完成（deployment-checklist §12）。
- 运维时健康检查：一个端点判断"为什么问数失败"。

**技术实现**：
- 后端：`GET /semantic/retrieval/readiness`。
- 前端：系统设置 → AI 配置页顶部展示 blockers 清单。

---

## 四、总结：三大主题的协同价值

| 主题 | 核心价值 | 关键能力 |
|---|---|---|
| **语义模型的建设** | 口径即资产，可信问数的根基 | 6 层模型 + 发布快照 + 口径治理 + 上游变更治理 + 语义检索 |
| **Data Agent 框架搭建** | 降低问数门槛，桌面闭环 | 桌面分析链路 + 专家团编排 + MCP 连接器 + 调度器 + 插件 |
| **知识体系自闭环** | 知识可被 agent 主动调用、可沉淀、可迭代 | 知识库 + 交叉引用 + 裸 SQL 审计 + 同义词治理 + 就绪自检 |

**三者协同**：
- 语义模型（CodataAdmin）提供"what to query"（权威口径）。
- Data Agent 框架（Codata）提供"how to query"（自然语言 → SQL → 结果）。
- 知识体系提供"why & how to use"（业务背景、使用说明、避坑）+ 治理闭环（审计、检索质量、健康检查）。

三大主题缺一不可，共同构成"团队可信赖、持续优化"的企业级 data agent 能力。

---

## 附录：功能模块清单速查

### 语义模型的建设（5 个模块）
1. 六层语义模型架构
2. 语义模型发布与快照管理
3. 口径治理：优先命中 + 自造标红 + 口径声明
4. 上游变更治理
5. 语义检索：三路 + RRF + 同义词治理

### Data Agent 框架搭建（5 个模块）
1. 桌面端分析闭环
2. 专家团多 Agent 编排
3. MCP 连接器 + 工具调用链路
4. 调度器 + 技能（Skills）
5. 插件与扩展能力

### 知识体系自闭环（5 个模块）
1. 知识库（Knowledge）+ 交叉引用
2. Codata 本地知识库 + 记忆
3. 裸 SQL 审计 + 调用方留痕
4. 同义词治理 + 检索质量闭环
5. 就绪自检（Readiness）+ Blockers
