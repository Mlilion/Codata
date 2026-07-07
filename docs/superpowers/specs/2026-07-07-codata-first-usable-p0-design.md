# Codata「首次可用」P0 设计

> 状态：待评审 · 日期：2026-07-07 · 范围：4 个 P0 阻断级改动

## Context（背景）

Codata 已从通用办公助手重定位为专属数据分析 agent。经两轮、六份真实代码审计，核心引擎（图表渲染、看板 pin/刷新、专家团多阶段分析、调度引擎、分析记忆、token 成本可观测）大多是真做的、能持久化。差距集中在「从零到第一次可信分析」的路径上。本设计覆盖其中 4 个**阻断级（P0）**问题——不修，用户就停留在 demo 阶段：

- **P0#1** 一个根因串起三个严重问题：`run_query` 只把「N 行·M 列」计数返回给 LLM，行数据仅进 metadata（供前端渲染）。后果：agent 看不到任何数值 → 无法总结/引用数字（叙述里会编造）、无法给 chart_spec 传 rows、多轮追问失效。
- **P0#2** 数字口径零校验：「优先用已注册指标」只是软建议，无强制、无任何数量级/交叉 sanity-check。手写 SQL 当核心指标会静默产出「貌似对其实错」的数字。对数据产品，错数字 = 死产品。
- **P0#3** 没有连数据源的路径：datasage 不在连接器目录，用户只能去 `/mcp` 手填 URL，无引导、无发现。
- **P0#4** 默认落 chat 模式 + 无 onboarding：新用户看到通用助手 + 遗留启动词，拿不到任何数据行为，也没有「连数据→配模型→开始分析」的引导。

四者相互独立，可分别实现、分别验证，共同打通「零到第一次可信分析」。

## 非目标（Out of scope）

- 多用户认证 / 权限治理 / 查询审计 / SQL 只读强制（P1，单独出计划）。
- 调度结果的「最后一公里」交付（邮件/IM 推送）（P1）。
- 分享/发布、保存查询、指标告警、查询成本可观测（P1/P2）。
- chat 模式遗留启动词/文案的清理（待「是否保留 chat 模式」的产品决策后单独处理）。
- 60s 异步超时 / 500 行硬截断 / 全量导出（P1）。

---

## 模块 1：run_query 把结果行喂回 LLM（最高杠杆）

**改动文件**：`backend/app/tool/builtin/run_query.py`、`backend/tests/test_tool/test_run_query.py`

**现状**：`_result_from_parsed`（`run_query.py:160-174`）把 `output` 设为 `"查询成功:N 行 · M 列"`，`columns`/`rows` 只进 `metadata`。`manager.py:509-514` 回放给 LLM 时只用 `output`（且经 `trim_for_context(max_tool_output_chars)` 二次截断，`manager.py:490`）。

**方案**：在 `output` 中，计数行之后追加一段结果预览（Markdown 表格）。新增独立函数 `_format_rows_preview(columns, rows, row_count) -> str` 便于单测。

预览规则：
1. **格式**：紧凑 Markdown 表格（token 效率优于 JSON）。
2. **行上限**：前 50 行（与 `chart_renderer` 类目上限一致）；超出时追加标注「(数据集共 X 行，以上为前 50 行预览；完整结果见数据面板)」。
3. **单元格截断**：单值超 ~200 字符截断，尾部加 `…`。
4. **总字符上限**：预览整体 ~4000 字符封顶，到顶即停并标注截断。**必须 ≤ `manager.py` 的 `max_tool_output_chars`**，否则表格尾部会被二次截断——实现时读取/对齐该配置值，取两者较小者。
5. **空结果**：0 行时 `output = "查询成功，但无数据行匹配"`。
6. **metadata 完全不变** → 前端 DataResultCard / 图表 / CSV 零改动。

**输出示例**：
```
查询成功:1234 行 · 4 列

| region | orders | gmv    |
|--------|--------|--------|
| 华东   | 5012   | 812301 |
| …（前 50 行）              |

(数据集共 1234 行，以上为前 50 行预览；完整结果见数据面板)
```

**测试**：`test_run_query.py` 补充断言——output 含预览表格、含总行数标注、超行截断标注生效、单元格超长截断、空结果文案；现有 metadata 形状断言保持不变。

**风险**：每次查询多喂 ≤4000 字符 token，有上限护栏——这是「能分析」的必要成本。

---

## 模块 2：口径强制校验 + 数量级 sanity-check

**改动文件**：`backend/app/agent/prompts/data.txt`、`backend/app/data/agency-agents-zh/data/metric-caliber-expert.md`（及呼应的角色文件）、`backend/app/tool/builtin/run_query.py`（工具 description 轻量提示）

**现状**：`data.txt:11` 用词为「prefer」注册指标；全库 grep「sanity/magnitude/交叉验证/数量级/核对」= 0 命中。

**方案**（prompt 层为主，不加硬代码 gate——「口径对不对」无法用代码可靠判定）：
1. **data.txt 升级口径为前置强制动作**：查任何核心业务指标（GMV/DAU/转化率等）前，**必须先 `search_indicators`** 找权威 `calculation_rule`；确无注册指标才可手写 SQL，且回复中注明「此为自定义口径，未经指标中心验证」，让不确定性显式化。
2. **data.txt 新增 sanity-check 步骤**：拿到数字后自检——数量级是否合常识？总数是否 ≈ 各分组之和？环比/同比是否异常到需怀疑口径或数据？发现矛盾时回头查证而非直接下结论。
3. **角色文件同步**：`metric-caliber-expert.md` 加入「先校准口径、再交叉核对数量级」的职责。
4. **run_query description 补一句**：查核心指标前先确认是否有已注册指标口径（模型行为的额外锚点）。

**不做**：SQL 静态分析判断口径正确性（不可靠、易误伤）。

**验证**：system_prompt/prompt 注入相关测试保证内容正确注入；人工用真实 LLM 走一遍核心指标查询，确认它先 `search_indicators` 再查、并做数量级自检。

---

## 模块 3：datasage 种子连接器 + 连接引导

**改动文件**：`backend/app/data/connectors.json`、`frontend/src/app/(main)/plugins/content.tsx`（连接器目录/添加表单）、一个轻量「连接状态」查询端点（供模块 4 用）

**现状**：`connectors.json` 46 个连接器中 data 类只有 BigQuery/Hex/Definite；datasage 只能作为自定义 MCP 手动添加。

**方案**（目录卡片 + 引导填 URL，不硬编码地址）：
1. **connectors.json 加 datasage 卡片**：`{id:"datasage", name:"datasage 数据平台", category:"data", description:"连接你的 datasage MCP 数据平台，用自然语言查询、分析、出图", icon:...}`，标记「需填写你的 MCP 地址」，**不带固定 URL**。
2. **复用现有连接流程**：点击卡片 → 复用 `AddConnectorForm` 填 URL → 走已有 OAuth/PAT 授权。即在「添加自定义连接器」之上给 datasage 预置入口 + 说明，非全新 UI。
3. **连接状态感知端点**：提供一个轻量端点，基于 `find_execute_sql_client` 思路返回「是否已连接 execute_sql 数据源」，供模块 4 空状态判断。

**取舍**：datasage URL 因部署而异，卡片只做「可发现 + 引导填写」。若团队有固定地址，可在实现时设为卡片默认占位值——spec 默认不硬编码（待评审确认）。

**验证**：目录出现 datasage 卡片 → 点击进入填 URL 流程 → 填真实地址 + 授权后 `find_execute_sql_client` 能找到、run_query 能跑。

---

## 模块 4：默认 codata 模式 + 空状态引导

**改动文件**：`frontend/src/stores/sidebar-store.ts`、Codata landing（`frontend/src/components/chat/landing.tsx` 的 codata 分支）

**现状**：`sidebar-store.ts:62` 默认 `appMode:"chat"`；无 onboarding。

**方案**（默认 codata + 空状态引导，不做完整向导）：
1. **默认改 codata**：初始 `appMode:"codata"`。它是持久化字段——只影响全新用户（空 localStorage），老用户保留各自选择、不被打扰。
2. **Codata landing 空状态引导**（核心，依赖模块 3 的连接状态端点）：
   - **未连接 datasage** → 三步引导卡片：① 连接数据源（跳连接器目录/datasage 卡片）② 配置模型（未配则跳 /settings）③ 开始第一次分析。
   - **已连接** → 现有分析建议（`useAnalysisRecommendations`）；零历史用数据向默认建议。
3. **修误标**：零历史时「基于你的分析历史」改为不谎称历史的文案（如「试试这些分析」）。

**验证**：全新用户（清 localStorage）→ 落 codata → 未连数据源见三步引导 → 连上后见分析建议；老用户模式选择不被覆盖。

---

## 实施顺序建议（按杠杆/成本比）

1. 模块 1（喂回数据行）—— 一处后端改动解三个严重问题，前端零联动。**最先。**
2. 模块 4（默认 codata + 空状态）—— 主要前端，改动小、体感强。
3. 模块 2（口径校验）—— prompt 层，低成本高信任收益。
4. 模块 3（datasage 种子连接器）—— 连接器目录 + 状态端点，模块 4 空状态依赖它，故与模块 4 协同实现。

## 端到端验证

- **后端**：`cd backend && source venv/bin/activate && python -m pytest tests/test_tool/test_run_query.py tests/test_session/ tests/test_expert/ -q` 全绿。
- **前端**：`cd frontend && npx tsc --noEmit && npx eslint && npx next build`。
- **人工全流程**（真实 datasage + LLM）：清 localStorage → 落 codata → 见三步引导 → 从目录连 datasage → 问一个核心指标 → 确认 agent 先 search_indicators、做 sanity-check、run_query 后能引用具体数字并出图 → 追问「按维度拆分」能基于上一轮结果继续。
