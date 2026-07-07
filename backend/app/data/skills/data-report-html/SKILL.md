---
name: data-report-html
description: 当用户需要一份数据分析报告、HTML 报告，或可分享/可交付的分析产物时使用。把 run_query 的查询结果和 search_indicators 的口径生成一个自包含的静态 HTML 数据报告（内联 CSS 与 SVG 图表，单文件、离线可看）。
tags: [数据分析, 报告, HTML, datasage]
icon: "📄"
---

# 数据报告 HTML 技能

把一次数据分析产出为一个**自包含的静态 HTML 报告**：单文件、内联所有 CSS 和 SVG 图表、数据快照内联、无外部依赖、双击即可离线查看，视觉与 Codata 一致、内容可信。

## 何时用
- 用户明确要"报告 / HTML / 可分享的分析产物 / 交付一份分析"。
- 专家团 finalization 交付数据分析报告。
- 日常一问一答的简单查询**不要**用本技能（那用内联卡片回答即可）。

## 工作流
1. 先完成分析：用 run_query 拿数据、search_indicators 确认核心指标口径（延续数据 agent 的口径要求）。
2. 读 `knowledge/report-structure.md`，按固定信息结构组织内容。
3. 读 `knowledge/svg-charting-rules.md`，用 `templates/` 里的 SVG 骨架把关键数据画成内联 SVG。
4. 读 `knowledge/credibility-rules.md`，确保口径声明、数据截至时间、事实/推断/建议三分到位。
5. 用 `templates/report-shell.html` 作骨架，把各段和图表填进去，产出完整 HTML。
6. 交付，按路径分支：
   - 专家团交付（reporter 有 write 权限）：用 write 写成 .html 文件，再用 present_file 打开预览，并用 artifact 呈现。
   - 单体 data agent（只读，不能 write/edit）：直接用 artifact 工具把完整 HTML 作为内容呈现（不写文件），不要调用 write/present_file。

## 分级
- **轻报告**：执行摘要 + KPI 卡 + 1-2 张图。单体 data agent 回答"出个报告"时用，避免小问题产出长篇。
- **完整报告**：全部信息段。专家团 finalization 用。

## 铁律
- 只用真实查询结果的数字，不编造；无数据的段落省略。
- 每个核心指标必须声明口径；自定义 SQL 口径标注"⚠️ 自定义口径，未经指标中心验证"。
- 报告头和口径段必须标数据截至时间。
- 归因结论区分 事实 / 推断 / 建议。
- 图表配色和数字格式化遵循 svg-charting-rules.md，不自由发挥。
