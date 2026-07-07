# data-report-html Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 bundled skill `data-report-html`，让单体 data agent 和 5 个数据分析专家团产出自包含静态 HTML 数据报告。

**Architecture:** 一个 skill 目录（SKILL.md + templates/ + knowledge/），由 SkillRegistry 目录扫描自动加载。产物是自包含 .html（内联 CSS + 内联 SVG 图表 + 数据快照）。图表用 LLM 按强规范手写内联 SVG，配色/格式化继承 chart-renderer。接线：改 5 个预设的 finalization 为 html + 加 skill 引用，data.txt 加触发说明。

**Tech Stack:** Markdown（SKILL.md/knowledge）、HTML/CSS/SVG（templates）、Python/pytest（加载测试）、YAML（预设）。

## Global Constraints

- Skill 目录：`backend/app/data/skills/data-report-html/`，SkillRegistry 目录扫描自动加载（`main.py:266-268` 的 `bundled_dir`），无需改注册代码。
- 后端测试：`cd backend && source venv/bin/activate && python -m pytest <path> -q`。
- 图表色板（写死，取自 chart-renderer COLORS）：`#4f8ff7 #f79f4f #4fcf8f #c77dff #f7746f #4fc4cf #f7c14f #8f9ff7`。
- 数字格式化（继承 chart-renderer）：轴/紧凑 = `≥1M→X.XM`、`≥10000→XK`、否则千分位；表格/完整值 = 千分位（`toLocaleString en-US`）。类目上限 50。
- SVG 画布固定：`viewBox="0 0 720 360"`，边距 左60 上20 右20 下40。
- 报告 CSS 必须内联具体色值（不能用 `var(--...)` 运行时变量——报告是独立文件）。
- 可信约束（延续 Task 6）：口径声明（注册口径 / ⚠️自定义未验证）、数据截至时间、事实/推断/建议三分、不编造。
- Commit `type: subject`。当前分支 `feat/data-agent-focus`。Git remote 用 SSH（`git push`）。
- SkillRegistry API：`SkillRegistry(bundled_dir=...)`、`.scan()`、`.count`、`.get(name)`、返回对象有 `.description`。
- 5 个数据分析预设：`ab_experiment.yaml data_analysis_report.yaml funnel_conversion.yaml ops_daily_diagnosis.yaml retention_cohort.yaml`（在 `backend/app/expert/presets/`）。

---

## Task 1: Skill 骨架 + knowledge 规范文档

**Files:**
- Create: `backend/app/data/skills/data-report-html/SKILL.md`
- Create: `backend/app/data/skills/data-report-html/knowledge/report-structure.md`
- Create: `backend/app/data/skills/data-report-html/knowledge/credibility-rules.md`
- Test: `backend/tests/test_skill/test_data_report_html_skill.py`

**Interfaces:**
- Produces: 一个名为 `data-report-html` 的 skill，frontmatter 含 `name` + `description`；被 SkillRegistry 扫描后 `.get("data-report-html")` 返回非 None。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_skill/test_data_report_html_skill.py`：

```python
"""Tests for the bundled data-report-html skill."""
from __future__ import annotations

from pathlib import Path

from app.skill.registry import SkillRegistry

BUNDLED = Path(__file__).resolve().parents[2] / "app" / "data" / "skills"
SKILL_DIR = BUNDLED / "data-report-html"


def test_skill_loads_from_bundled_dir():
    reg = SkillRegistry(bundled_dir=BUNDLED)
    reg.scan()
    skill = reg.get("data-report-html")
    assert skill is not None
    assert len(skill.description) > 10


def test_skill_has_knowledge_and_templates():
    assert (SKILL_DIR / "knowledge" / "report-structure.md").is_file()
    assert (SKILL_DIR / "knowledge" / "credibility-rules.md").is_file()
    assert (SKILL_DIR / "knowledge" / "svg-charting-rules.md").is_file()
    assert (SKILL_DIR / "templates" / "report-shell.html").is_file()
    assert (SKILL_DIR / "templates" / "chart-bar.svg").is_file()


def test_credibility_rules_cover_caliber_and_asof():
    text = (SKILL_DIR / "knowledge" / "credibility-rules.md").read_text(encoding="utf-8")
    assert "自定义口径" in text
    assert "数据截至" in text
    # fact / inference / recommendation split
    assert "事实" in text and "推断" in text and "建议" in text
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_skill/test_data_report_html_skill.py -q`
Expected: FAIL（skill 不存在 / 文件缺失）。

- [ ] **Step 3: 写 SKILL.md**

创建 `backend/app/data/skills/data-report-html/SKILL.md`：

```markdown
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
6. 用 write 写成 .html 文件，并用 present_file + artifact 交付（文件可下载 + 面板可预览）。

## 分级
- **轻报告**：执行摘要 + KPI 卡 + 1-2 张图。单体 data agent 回答"出个报告"时用，避免小问题产出长篇。
- **完整报告**：全部信息段。专家团 finalization 用。

## 铁律
- 只用真实查询结果的数字，不编造；无数据的段落省略。
- 每个核心指标必须声明口径；自定义 SQL 口径标注"⚠️ 自定义口径，未经指标中心验证"。
- 报告头和口径段必须标数据截至时间。
- 归因结论区分 事实 / 推断 / 建议。
- 图表配色和数字格式化遵循 svg-charting-rules.md，不自由发挥。
```

- [ ] **Step 4: 写 report-structure.md**

创建 `backend/app/data/skills/data-report-html/knowledge/report-structure.md`，内容为 spec 的 8 段信息结构（逐段说明 + 必需/按需标注 + 轻报告/完整报告分级）。必须包含这些小节标题文字：报告头、执行摘要、KPI 卡片行、图表区、数据明细表、归因与洞察、口径与数据来源声明、风险与待确认。每节写清：放什么内容、对应用哪个 template 片段、什么情况省略。

- [ ] **Step 5: 写 credibility-rules.md**

创建 `backend/app/data/skills/data-report-html/knowledge/credibility-rules.md`，包含四条可信约束的具体要求，且必须出现字符串 `自定义口径`、`数据截至`、`事实`、`推断`、`建议`（测试断言）。写清：口径声明格式（注册口径 vs ⚠️自定义口径，未经指标中心验证）、as-of 时间放哪、事实/推断/建议如何视觉区分（不同标签/颜色）、不编造原则。

- [ ] **Step 6: 运行确认通过**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_skill/test_data_report_html_skill.py -q`
Expected: `test_skill_loads_from_bundled_dir` + `test_credibility_rules_cover_caliber_and_asof` PASS；`test_skill_has_knowledge_and_templates` 仍 FAIL（templates + svg-charting-rules 还没建，Task 2 完成）。这是预期的部分通过。

- [ ] **Step 7: 提交**

```bash
git add backend/app/data/skills/data-report-html/SKILL.md backend/app/data/skills/data-report-html/knowledge/ backend/tests/test_skill/test_data_report_html_skill.py
git commit -m "feat: data-report-html skill scaffold + structure/credibility knowledge"
```

---

## Task 2: HTML/SVG 模板 + SVG 图表规范

**Files:**
- Create: `backend/app/data/skills/data-report-html/knowledge/svg-charting-rules.md`
- Create: `backend/app/data/skills/data-report-html/templates/report-shell.html`
- Create: `backend/app/data/skills/data-report-html/templates/kpi-card.html`
- Create: `backend/app/data/skills/data-report-html/templates/data-table.html`
- Create: `backend/app/data/skills/data-report-html/templates/chart-bar.svg`
- Create: `backend/app/data/skills/data-report-html/templates/chart-line.svg`
- Create: `backend/app/data/skills/data-report-html/templates/chart-area.svg`
- Create: `backend/app/data/skills/data-report-html/templates/chart-pie.svg`
- Test: 复用 Task 1 的 `test_skill_has_knowledge_and_templates`（现在应全绿）+ 新增自包含校验测试。

**Interfaces:**
- Consumes: Task 1 的 skill 目录。
- Produces: `report-shell.html`（自包含骨架，含占位符注释）、4 个 SVG 骨架、KPI/表格片段、svg-charting-rules.md（含色板/坐标公式/格式化/自检）。

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_skill/test_data_report_html_skill.py` 追加：

```python
def test_report_shell_is_self_contained():
    html = (SKILL_DIR / "templates" / "report-shell.html").read_text(encoding="utf-8")
    # 内联样式，无外部依赖
    assert "<style>" in html
    assert "http://" not in html and "https://" not in html
    assert "<link" not in html and "<script src=" not in html


def test_svg_rules_have_palette_and_viewbox():
    text = (SKILL_DIR / "knowledge" / "svg-charting-rules.md").read_text(encoding="utf-8")
    assert "#4f8ff7" in text            # 首色，锚定色板继承自 chart-renderer
    assert "0 0 720 360" in text        # 固定画布
    assert "padLeft" in text or "x =" in text  # 坐标映射公式


def test_svg_skeletons_use_fixed_viewbox():
    for name in ("chart-bar.svg", "chart-line.svg", "chart-area.svg", "chart-pie.svg"):
        svg = (SKILL_DIR / "templates" / name).read_text(encoding="utf-8")
        assert "viewBox" in svg
    # bar/line/area 用固定画布；pie 可用正方形画布
    for name in ("chart-bar.svg", "chart-line.svg", "chart-area.svg"):
        assert "0 0 720 360" in (SKILL_DIR / "templates" / name).read_text(encoding="utf-8")
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_skill/test_data_report_html_skill.py -q`
Expected: 新增 3 个测试 FAIL（文件缺失）。

- [ ] **Step 3: 写 svg-charting-rules.md**

创建，必须包含：
- 色板（写死 8 色，首色 `#4f8ff7`）：`#4f8ff7 #f79f4f #4fcf8f #c77dff #f7746f #4fc4cf #f7c14f #8f9ff7`，第 i 个 series 用第 `i % 8` 色。
- 固定画布 `viewBox="0 0 720 360"`（pie 用 `viewBox="0 0 360 360"`）；边距 padLeft=60 padTop=20 padRight=20 padBottom=40；`plotW = 720-60-20 = 640`、`plotH = 360-20-40 = 300`。
- 坐标映射公式：
  - x（第 i 个点，共 n 个）：`x = padLeft + (i/(n-1))*plotW`（n=1 时居中）。
  - y（值 v，最大值 max）：`y = padTop + (1 - v/max)*plotH`。
  - bar 宽度：`barW = plotW/n * 0.7`。
  - pie 扇形：角度 = `value/total*360`，累加，用 SVG path arc。
- 数字格式化（继承 chart-renderer）：轴刻度 `≥1e6→X.XM`、`≥1e4→XK`、否则千分位；数据表/完整值用千分位。类目 > 50 要求先聚合。
- 自检清单：柱高与数值成比例？所有点在 padding 内？pie 角度和=360°？轴刻度 3-5 档均匀？
- 每种图给一个"如何填骨架"的说明，指向对应 templates/*.svg。

- [ ] **Step 4: 写 4 个 SVG 骨架**

创建 `chart-bar.svg` / `chart-line.svg` / `chart-area.svg`（均 `viewBox="0 0 720 360"`）和 `chart-pie.svg`（`viewBox="0 0 360 360"`）。每个是一个带占位符注释的可直接内联的 SVG 样板：含标题位、坐标轴（bar/line/area）、网格线、示例数据元素（用注释标 `<!-- repeat per data point: <rect x=.. y=.. .../> -->`）、图例位。颜色用色板首几色。文字色用具体值（如 `#6b7280` 作次要文字、`#111827` 作主文字——不用 CSS 变量）。

chart-bar.svg 示例结构：

```svg
<svg viewBox="0 0 720 360" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">
  <!-- title -->
  <text x="60" y="16" font-size="13" font-weight="600" fill="#111827"><!-- CHART TITLE --></text>
  <!-- y axis grid + ticks: 3-5 evenly spaced. y = padTop + (1 - tickVal/max)*plotH -->
  <!-- example gridline -->
  <line x1="60" y1="20" x2="700" y2="20" stroke="#eceff3"/>
  <line x1="60" y1="320" x2="700" y2="320" stroke="#d0d5dd"/>
  <!-- bars: for each i in 0..n-1: x = 60 + (i+0.15)*(640/n); w = (640/n)*0.7;
       barTop = 20 + (1 - v/max)*300; h = 320 - barTop -->
  <!-- <rect x=".." y=".." width=".." height=".." fill="#4f8ff7" rx="2"/> -->
  <!-- x labels: <text x=".." y="336" font-size="11" fill="#6b7280" text-anchor="middle">label</text> -->
</svg>
```

（line/area/pie 类似，各给完整可填的骨架。）

- [ ] **Step 5: 写 report-shell.html**

创建自包含骨架：`<!DOCTYPE html>` + `<head>` 内联 `<style>`（浅色主题，具体色值：背景 `#ffffff`/`#f8fafc`、主文字 `#111827`、次文字 `#6b7280`、边框 `#e5e7eb`、成功/上涨 `#16a34a`、警告/下跌 `#dc2626`、主色 `#4f8ff7`；卡片圆角/阴影/间距对齐 app 观感）。`<body>` 含 8 段的占位结构（每段用 HTML 注释标 `<!-- 执行摘要：... -->`），KPI 卡片行用 grid，响应式（max-width ~900px 居中，窄屏堆叠）。**无任何外部 http(s) 链接、无 `<link>`、无 `<script src>`。**

- [ ] **Step 6: 写 kpi-card.html + data-table.html**

`kpi-card.html`：单张 KPI 卡片片段（指标名 + 大数值 + 环比/同比，升降色用 `#16a34a`/`#dc2626`，占位符注释）。
`data-table.html`：表格片段（数字右对齐、千分位、null 留空的样式说明 + 占位符）。

- [ ] **Step 7: 运行确认全绿**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_skill/test_data_report_html_skill.py -q`
Expected: 全部 PASS（Task 1 的 3 个 + Task 2 的 3 个）。

- [ ] **Step 8: 浏览器自包含校验（人工）**

用浏览器打开 `backend/app/data/skills/data-report-html/templates/report-shell.html`，确认：无 404/外部请求、样式正常、骨架布局合理。（chromium 自动化不可用，人工开一次即可。）

- [ ] **Step 9: 提交**

```bash
git add backend/app/data/skills/data-report-html/templates/ backend/app/data/skills/data-report-html/knowledge/svg-charting-rules.md backend/tests/test_skill/test_data_report_html_skill.py
git commit -m "feat: data-report-html templates + SVG charting rules

Self-contained HTML shell (inline CSS, no external deps), KPI/table fragments,
4 SVG chart skeletons (fixed 720x360 viewBox, palette + coordinate formulas
inherited from chart-renderer)."
```

---

## Task 3: 接线到专家团预设 + 单体 data agent

**Files:**
- Modify: `backend/app/expert/presets/ab_experiment.yaml`
- Modify: `backend/app/expert/presets/data_analysis_report.yaml`
- Modify: `backend/app/expert/presets/funnel_conversion.yaml`
- Modify: `backend/app/expert/presets/ops_daily_diagnosis.yaml`
- Modify: `backend/app/expert/presets/retention_cohort.yaml`
- Modify: `backend/app/agent/prompts/data.txt`
- Test: `backend/tests/test_expert/test_data_analysis_team.py`（加断言）+ 现有 preset 测试保持绿。

**Interfaces:**
- Consumes: Task 1 的 skill id `data-report-html`。
- Produces: 5 个预设 finalization 交付 html + skills 含 data-report-html；data.txt 引导用该 skill。

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_expert/test_data_analysis_team.py` 追加（先确认现有 import 有 registry + PRESETS_DIR）：

```python
class TestReportDeliverable:
    def test_presets_deliver_html_report(self):
        reg = ExpertTeamRegistry(presets_dir=PRESETS_DIR)
        reg.scan()
        for tid in ("data-analysis-report", "funnel-conversion", "ops-daily-diagnosis",
                    "retention-cohort", "ab-experiment"):
            team = reg.get(tid)
            assert team is not None, tid
            deliverable = team.finalization.deliverable
            assert deliverable is not None, tid
            assert deliverable.type == "html", tid
            # skill 引用到位
            assert "data-report-html" in team.skills, tid
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_expert/test_data_analysis_team.py::TestReportDeliverable -q`
Expected: FAIL（type 仍是 markdown / skills 不含 data-report-html）。

- [ ] **Step 3: 改 5 个预设**

每个预设做三处改动：
1. `finalization.deliverable.type: markdown` → `html`。
2. `finalization.deliverable.filename_template` 后缀 `.md` → `.html`（如 `data-analysis-report.html`）。
3. `skills:` 列表加入 `data-report-html`（团队级 skills；若某成员需要也可加，但团队级即可）。

以 `data_analysis_report.yaml` 为例，finalization 段改为：

```yaml
  finalization:
    mode: deliverable
    member: reporter
    tools: [write, present_file, artifact]
    deliverable:
      required: true
      type: html
      title: 数据分析报告
      filename_template: data-analysis-report.html
```

并在团队顶层 `skills:` 加 `data-report-html`（保留原有 data-analysis/charting/report）。其余 4 个同理，各自的 title/filename 用各自主题（funnel-conversion.html 等）。

- [ ] **Step 4: 改 data.txt**

在 `backend/app/agent/prompts/data.txt` 的工作流末尾（"keep your text brief" 那步之后、"Follow-up suggestions" 之前）加一步：

```
7. When the user asks for a report / an HTML report / a shareable or
   deliverable analysis (not a quick one-off question), use the
   `data-report-html` skill to produce a self-contained HTML data report
   instead of a plain-text answer. Everyday single questions still get the
   inline card answer.
```

（注意现有 data.txt 步骤编号——Task 6 已把 sanity-check 插为步骤 6，原步骤顺延。确认当前编号后接续，不要编号冲突。）

- [ ] **Step 5: 运行确认通过 + 回归**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_expert/ tests/test_skill/ -q`
Expected: 全绿（新断言通过 + 现有专家团/skill 测试不回归；注意 test_preset_registry 若断言了 deliverable 细节需一并核对）。

- [ ] **Step 6: 提交**

```bash
git add backend/app/expert/presets/ backend/app/agent/prompts/data.txt backend/tests/test_expert/test_data_analysis_team.py
git commit -m "feat: wire data-report-html into data agent + expert-team delivery

5 data-analysis presets now deliver an HTML report (type html + filename .html
+ data-report-html skill); data agent prompt steers report requests to the
skill instead of plain text."
```

---

## 最终验证（全部任务后）

- [ ] **后端全量**

Run: `cd backend && source venv/bin/activate && python -m pytest tests/ -q`
Expected: 仅剩已知 5 个 web_search 预存失败，其余全绿。

- [ ] **前端不受影响确认**

本计划不改前端代码（html-renderer 已存在）。跳过 tsc/build，除非发现 artifact html 类型渲染有问题。

- [ ] **端到端人工验证**（真实 LLM + datasage）

在 codata 模式问一个分析问题、要求"出一份 HTML 报告" → 确认：产物结构完整（8 段/轻报告）、SVG 图表比例正确、口径声明 + 数据截至时间在、事实/推断/建议区分、artifact 面板能渲染、下载的 .html 双击可看。再召唤一个数据分析专家团 → 确认 finalization 产出 .html 而非 .md。

- [ ] **推送**

```bash
git push
```

---

## Self-Review 记录

- **Spec 覆盖**：信息结构 8 段 → Task1 report-structure.md；SVG 规范 + 模板 → Task2；可信约束 → Task1 credibility-rules.md；skill 结构 → Task1+2；接线（预设+data.txt）→ Task3；验证 → 各任务测试 + 最终人工。全覆盖。
- **Placeholder**：SVG/HTML 模板本身含"占位符注释"是有意为之（供 LLM 填充），非计划漏洞；每个文件的必需内容已具体到色值/公式/断言字符串。
- **类型一致**：skill id `data-report-html` 在 Task1 定义、Task3 引用一致；色板 `#4f8ff7...` 在 Global Constraints、Task2 规范、SVG 骨架、测试断言中一致；`viewBox 0 0 720 360` 在规范/骨架/测试中一致；deliverable `type: html` 在 Task3 改动与测试断言一致。
- **风险标注**：LLM 手写 SVG 质量不稳时，备选升级路径（后端 spec→SVG）见 spec 非目标段，本计划不含。
