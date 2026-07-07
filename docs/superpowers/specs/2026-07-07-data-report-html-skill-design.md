# data-report-html Skill 设计

> 状态：待评审 · 日期：2026-07-07 · 范围：新增一个 bundled skill，让 Codata 产出自包含静态 HTML 数据报告

## Context（背景）

Codata 是数据分析 agent，交付产物应针对数据场景优化。当前 5 个数据分析专家团交付 **markdown**，单体 data agent 只出内联卡片，没有"正式的、可分享的数据报告"这一交付形态。之前清理通用 skill 时删掉了 html-page-generator / web-artifacts-builder 等，所以目前**没有任何"会做数据报告 HTML"的能力**。

目标：新增 skill `data-report-html`，产出**自包含的静态 HTML 数据报告**——单文件、内联 CSS 与 SVG 图表、数据快照内联、零外部依赖、离线可看，且视觉与 app 一致、内容可信。

**已定的关键决策**（brainstorm 结论）：
- 交付形态：**静态自包含快照**（非活报告/交互——活报告是 dashboard 领域，未来若做走 B 方案另行设计）。
- 触发场景：**单体 data agent + 5 个数据分析专家团都用**（共享 skill）。
- 展示：**both**（write 文件可下载 + artifact 面板渲染，复用现有 html-renderer）。
- 图表：**内联 SVG，LLM 按强规范手写**（复用 chart_spec 契约 + chart-renderer 的配色/格式化/选型规范；recharts 的 React 运行时不进报告，只继承其视觉品味）。

## 架构与产物

- 新 skill 目录 `backend/app/data/skills/data-report-html/`，由 SkillRegistry 目录扫描自动加载（`backend/app/main.py:266-268`），无需改注册代码。
- 产物 = 一个自包含 `.html`：内联所有 CSS、内联 SVG 图表、数据快照内联、无外部依赖。
- Agent 工作流：`run_query` 拿数 + `search_indicators` 拿口径 → 调用本 skill（获得信息结构规范 + HTML 模板 + SVG 规范 + 可信约束）→ 填模板、手写内联 SVG → `write` .html + `present_file` + `artifact` 交付。
- **边界**：静态快照报告 ≠ dashboard（用户自搭的可刷新监控台）≠ 活报告。三者互补。

## 报告信息结构规范（skill 的核心价值）

固定信息骨架（从上到下），约束 LLM 不自由发挥：

1. **报告头** — 标题、生成时间、数据截至时间、分析周期。
2. **执行摘要** — 一句话结论 + 2-3 条关键发现。
3. **KPI 卡片行** — 核心指标当期值 + 环比/同比（升降色）。
4. **图表区** — 趋势(line/area)、对比(bar)、占比(pie)，每图带标题 + 一句话图注。
5. **数据明细表** — 关键结果表格（数字右对齐、千分位、null 留空；视觉对齐 app 的 DataTable）。
6. **归因与洞察** — 严格区分 事实 / 推断 / 建议，视觉区分标签。
7. **口径与数据来源声明** — 每个核心指标的口径（注册口径 or ⚠️自定义未验证）、数据来自哪个查询/表、数据截至时间。**报告可信的压舱石。**
8. **风险与待确认** — 样本偏差、口径存疑、需人工确认项。

**必需 vs 按需**：头/执行摘要/口径声明**必需**；其余按内容有无省略（空段省略而非留白）。

**分级**：
- **轻报告**（摘要 + KPI + 1-2 图）— 单体 data agent 常用，避免小问题产出长报告。
- **完整报告**（全 8 段）— 专家团 finalization 用。

## SVG 图表规范（svg-charting-rules.md）

LLM 手写 SVG 的风险：坐标手算易出比例失真/点位偏移。**用强规范把自由度压到最低**：

1. **固定画布 + 固定边距**：`viewBox="0 0 720 360"`，绘图区边距写死（左 60 上 20 右 20 下 40）。
2. **给定坐标映射公式**：`x = padLeft + (i/(n-1))*plotW`；`y = padTop + (1 - v/max)*plotH`。LLM 照套不即兴。
3. **限制数据点**：≤ 50 类目（沿用 chart-renderer 上限），超出要求先聚合。
4. **每种图给完整 SVG 骨架模板**（bar/line/area/pie），LLM 填数据不重画结构。
5. **配色/格式化对齐**：固定色板（取自 dataviz skill 规范 + chart-renderer 现有配色，写死具体色值）；数字格式化沿用 chart-renderer（轴 12.3K、表格/tooltip 12,304）。
6. **自检清单**：柱高与数值成比例？点在画布内？pie 扇形角度和 = 360°？

**备选升级路径**（若手写 SVG 质量不稳）：后端加 `spec→SVG` 渲染函数（复用 chart-renderer 规则），agent 调用得 SVG 再内联。本 spec 先走手写 + 强规范。

## Skill 目录结构

```
backend/app/data/skills/data-report-html/
├── SKILL.md                    # 主指令：何时用/工作流/可信约束/分级
├── templates/
│   ├── report-shell.html       # 完整 HTML 骨架(内联 CSS + 占位符)
│   ├── kpi-card.html
│   ├── chart-bar.svg           # SVG 骨架 + 坐标公式注释
│   ├── chart-line.svg
│   ├── chart-area.svg
│   ├── chart-pie.svg
│   └── data-table.html
└── knowledge/
    ├── report-structure.md     # 信息结构规范(8 段 + 分级)
    ├── svg-charting-rules.md    # 坐标公式/色板/格式化/自检
    └── credibility-rules.md     # 口径声明/事实-推断-建议/数据截至
```

- **SKILL.md frontmatter**：`name: data-report-html`；`description` 写成"何时用"（当用户要数据分析报告/HTML报告/可分享分析产物时），确保正确触发；标签体现数据领域。
- **report-shell.html CSS**：内联自包含样式，配色用 app CSS 变量的**具体色值快照**（报告是独立文件，不能引用运行时 CSS 变量），浅色为主（深色可选，本期不做）。

## 与 agent / 专家团接线

- **5 个数据分析预设**（`backend/app/expert/presets/*.yaml`）：`finalization.deliverable` 从 `type: markdown` 改 `type: html`；`skills` 加 `data-report-html`；`filename_template` 改 `.html`。
- **单体 data agent**（`backend/app/agent/prompts/data.txt`）：加一句——需要正式报告/可分享产物时，用 `data-report-html` skill 出 HTML 报告（区别于日常内联卡片回答）。

## 可信约束（credibility-rules.md）— 与外部通用 skill 的根本差异

1. **口径声明强制**：注册指标写"权威口径"，自定义写"⚠️ 自定义口径，未经指标中心验证"（延续 Task 6）。
2. **数据截至时间必现**：报告头 + 口径段都标 as-of 时间。
3. **事实/推断/建议三分**：归因段每条打标签，不把推断写成事实。
4. **不编造**：数字只来自 run_query 实际结果，可追溯；无数据的段省略，不填占位。

## 验证

1. **加载验证**：写测试断言 skill 被 SkillRegistry 扫到、frontmatter 合法（仿现有 skill 测试，如 tests/test_skill/）。
2. **模板自包含验证**：`report-shell.html` 单独浏览器打开正常渲染（内联 CSS/SVG 不依赖外部）。
3. **端到端人工验证**（真实 LLM + datasage）：问一个分析问题、要求出 HTML 报告 → 确认结构完整、图表比例正确、口径声明与数据截至时间在、artifact 面板能渲染、下载文件双击可看。
4. **专家团接线验证**：召唤一个数据分析专家团 → finalization 产出 html（非 markdown）。

## 非目标（Out of scope）

- 活报告 / 报告内交互 / 刷新（dashboard 领域；未来 B 方案单独设计）。
- PDF 导出（可后续从 HTML 转）。
- 多主题 / 深色报告（先浅色）。
- 后端 spec→SVG 渲染（备选升级路径，本期用 LLM 手写 + 强规范）。
