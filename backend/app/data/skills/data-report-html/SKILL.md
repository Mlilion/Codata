---
name: data-report-html
description: 当用户需要一份数据分析报告、HTML 报告，或可分享/可交付的分析产物时使用。把分析结果整理成结构化数据，调用 build_report 工具生成一个带 echarts 交互图表的单文件 HTML 报告（浅色主题，右侧面板查看,可在浏览器打开）。
tags: [数据分析, 报告, HTML, datasage]
icon: "📄"
---

# 数据报告 HTML 技能

把一次数据分析交付为一份**交互式 HTML 报告**。关键:**你不用手写 HTML** —— 你只需把分析结果整理成**结构化数据**,调用 `build_report` 工具,服务端会用固定模板 + echarts 渲染成自包含的报告(浅色主题、hover 交互、口径声明齐全),在右侧产物面板展示,并可一键在浏览器打开。

> 为什么用工具而不是自己写 HTML:一次性输出整份 HTML 会超出工具参数长度被截断。传结构化数据既可靠又紧凑,而且结构/配色/口径声明由服务端保证正确。

## 何时用
- 用户明确要"报告 / HTML / 可分享的分析产物 / 交付一份分析"。
- 专家团 finalization 交付数据分析报告。
- 日常一问一答的简单查询**不要**用本技能(那用内联卡片回答即可)。

## 工作流
1. 先完成分析:用 `run_query` 拿数据、`search_indicators` 确认核心指标口径。
2. 读 `knowledge/report-structure.md`,想清楚报告要包含哪些段落(执行摘要、KPI、图表、明细、归因洞察、口径声明、风险)。
3. 读 `knowledge/credibility-rules.md`,准备好口径声明、数据截至时间、事实/推断/建议的区分。
4. 把分析结果整理成 `build_report` 的结构化参数(见下),**一次调用** `build_report` 生成报告。图表数据直接放进 `charts[].series`,服务端用浅色 echarts 规范渲染,你不用写 echarts 配置。
5. 报告会出现在右侧产物面板;告诉用户可点面板里的「在浏览器打开」查看完整交互报告。

## build_report 参数(结构化,不是 HTML)
- `title`(必填)、`identifier`(必填,kebab-case 稳定 id)、`subtitle`
- `meta`: `{data_as_of, generated_at, source}` —— 数据截至时间、生成时间、来源表
- `summary`: 执行摘要要点数组(一句话结论 + 2-3 条关键发现)
- `kpis`: `[{name, value, delta_pct, delta_dir:'up'|'down'|'flat'}]` 核心指标卡
- `charts`: `[{type:'line'|'bar'|'stacked_bar'|'pie', title, x:[类目], series:[...], caption}]`
  - line/bar/stacked_bar: `series:[{name, data:[数值]}]` + `x` 为类目轴
  - pie: `series:[{name, value}]`
  - 数据直接内联,不要写 echarts option —— 服务端负责浅色主题、配色、交互
- `table`: `{columns:[列名], numeric:[每列是否数字右对齐], rows:[[单元格]], note}`
- `insights`: `[{kind:'fact'|'inference'|'recommendation', text}]` 归因洞察,三分区
- `caliber`: `[{metric, desc, custom:true?}]` 口径声明;自定义未验证口径设 `custom:true`
- `caveats`: 风险与待确认数组

## 分级
- **轻报告**:执行摘要 + KPI + 1-2 张图。单体 data agent 回答"出个报告"时用。
- **完整报告**:全部段落。专家团 finalization 用。

## 铁律
- 只用真实查询结果的数字,不编造;没有的段落就不传(留空即省略)。
- 每个核心指标必须在 `caliber` 声明口径;自定义 SQL 口径设 `custom:true`(会显示"⚠️ 自定义口径,未经指标中心验证")。
- `meta.data_as_of` 必填 —— 报告头会显示数据截至时间。
- 归因结论用 `insights` 的 `kind` 区分 事实 / 推断 / 建议。
- 图表只传数据(`charts[].series`),不要自己写 HTML 或 echarts 配置 —— 服务端统一渲染,保证浅色主题与配色一致、交互可用。
