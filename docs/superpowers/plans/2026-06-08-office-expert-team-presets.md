# Office Expert Team Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eight high-frequency office expert teams as built-in, read-only presets that users can browse, summon, and copy but cannot edit or delete.

**Architecture:** Built-in teams are YAML files under `backend/app/expert/presets/`, loaded by `ExpertTeamRegistry` with `is_preset=True` and `editable=False` by existing registry behavior. The work does not need new runtime code: it adds validated preset data, strengthens preset registry tests, and updates bundle verification so release packages include the new YAML files.

**Tech Stack:** Python 3.12, Pydantic expert-team models, YAML presets, pytest, Node.js `node:test`, PyInstaller bundle verification.

---

## File Structure

- Modify: `backend/tests/test_expert/test_preset_registry.py`
  - Replace the current single-video expectation with the full office preset ID set.
  - Add checks that all built-in presets validate cleanly, are `is_preset=True`, are `editable=False`, and cannot be deleted.
- Create: `backend/app/expert/presets/data_analysis_report.yaml`
  - 数据分析报告专家团.
- Create: `backend/app/expert/presets/meeting_notes_actions.yaml`
  - 会议纪要与行动项专家团.
- Create: `backend/app/expert/presets/weekly_monthly_report.yaml`
  - 周报/月报生成专家团.
- Create: `backend/app/expert/presets/document_review_polish.yaml`
  - 文档总结与审校专家团.
- Create: `backend/app/expert/presets/presentation_briefing.yaml`
  - PPT/汇报材料专家团.
- Create: `backend/app/expert/presets/research_competitive_analysis.yaml`
  - 研究与竞品分析专家团.
- Create: `backend/app/expert/presets/sales_proposal.yaml`
  - 客户提案与销售方案专家团.
- Create: `backend/app/expert/presets/project_plan_risk.yaml`
  - 项目计划与风险评审专家团.
- Modify: `scripts/verify-bundle.mjs`
  - Require all eight new preset YAML files in the packaged backend.
- Modify: `scripts/release-workflow.test.mjs`
  - Make the bundle guard test assert every required preset filename, not only `video_production.yaml`.

## Preset Design Rules

Use these rules for every YAML file:

- Root shape: `team: { ... }`, matching `backend/app/expert/presets/video_production.yaml`.
- IDs use hyphenated lowercase for team ID and snake_case for output variables.
- `category` must be one of the existing front-end category tabs when possible: `办公文档` or `研究咨询`.
- All eight teams should be summonable immediately. Do not add a "coming soon" gate.
- Do not give research/analysis experts `write`, `edit`, or `bash`.
- Only the final writer/deliverable member should use `write`, `present_file`, `artifact`, and format-specific skills.
- Prefer `process: workflow` where parallel branches help; use `sequential` for linear drafting and review.
- Use `interaction_mode: auto`, `max_clarifying_questions: 4`, `on_question_timeout: continue_with_assumptions`.
- Use `expert_output_style: concise`, `expert_visible_max_chars: 1800`, `coordinator_visible_max_chars: 2400`.
- Use `finalization.mode: deliverable` for every team. Final deliverables should be visible in the artifact panel or file preview.
- Every task template may reference only allowed variables: `{{user_input}}`, `{{attachments}}`, `{{workspace}}`, `{{clarifications}}`, declared `inputs`, and upstream outputs.

## Required Built-In Preset IDs

The final preset ID set should be exactly:

```python
EXPECTED_PRESET_IDS = {
    "video-production",
    "data-analysis-report",
    "meeting-notes-actions",
    "weekly-monthly-report",
    "document-review-polish",
    "presentation-briefing",
    "research-competitive-analysis",
    "sales-proposal",
    "project-plan-risk",
}
```

---

### Task 1: Strengthen Preset Registry Tests

**Files:**
- Modify: `backend/tests/test_expert/test_preset_registry.py`

- [ ] **Step 1: Write the failing preset registry tests**

Replace the whole file with:

```python
from pathlib import Path

import pytest

from app.expert.registry import ExpertTeamRegistry
from app.expert.validation import validate_expert_team_config


EXPECTED_PRESET_IDS = {
    "video-production",
    "data-analysis-report",
    "meeting-notes-actions",
    "weekly-monthly-report",
    "document-review-polish",
    "presentation-briefing",
    "research-competitive-analysis",
    "sales-proposal",
    "project-plan-risk",
}


def _registry(tmp_path: Path) -> ExpertTeamRegistry:
    registry = ExpertTeamRegistry(
        presets_dir=Path(__file__).resolve().parents[2] / "app" / "expert" / "presets",
        user_dir=tmp_path / "user-teams",
    )
    registry.scan()
    return registry


def test_builtin_presets_include_office_expert_teams(tmp_path: Path) -> None:
    registry = _registry(tmp_path)

    preset_ids = {team.id for team in registry.list_teams() if team.is_preset}

    assert preset_ids == EXPECTED_PRESET_IDS


def test_builtin_presets_are_valid_read_only_and_not_deletable(tmp_path: Path) -> None:
    registry = _registry(tmp_path)

    for summary in registry.list_teams():
        if summary.id not in EXPECTED_PRESET_IDS:
            continue
        team = registry.get_or_raise(summary.id)
        metadata = registry.metadata(summary.id)

        assert summary.is_preset is True
        assert summary.editable is False
        assert metadata["is_preset"] is True
        assert metadata["editable"] is False
        assert validate_expert_team_config(team) == []
        with pytest.raises(ValueError, match="Preset expert teams cannot be deleted"):
            registry.delete_user_team(summary.id)
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd backend && ./.venv/bin/python -m pytest tests/test_expert/test_preset_registry.py -q
```

Expected: FAIL because only `video-production` exists today and the eight office preset YAML files have not been added yet.

- [ ] **Step 3: Commit the failing test is not allowed**

Do not commit after the RED step. Continue to Task 2.

---

### Task 2: Add Data Analysis Report Preset

**Files:**
- Create: `backend/app/expert/presets/data_analysis_report.yaml`
- Test: `backend/tests/test_expert/test_preset_registry.py`

- [ ] **Step 1: Create `data_analysis_report.yaml`**

Create the file with:

```yaml
team:
  id: data-analysis-report
  name: 数据分析报告专家团
  description: 读取 Excel/CSV 或业务数据材料，完成数据清洗、指标分析、异常识别和管理层报告交付。
  icon: bar-chart-2
  category: 办公文档
  tags: [数据分析, Excel, CSV, 经营分析, 报告]
  version: "1.0"
  process: workflow
  concurrency: 2
  default_max_tool_rounds: 8
  interaction_mode: auto
  max_clarifying_questions: 4
  question_timeout_seconds: 300
  on_question_timeout: continue_with_assumptions
  expert_output_style: concise
  expert_visible_max_chars: 1800
  coordinator_visible_max_chars: 2400
  coordinator_context_policy: summary
  coordinator_context_max_chars: 36000
  coordinator_prompt: |
    你是数据分析报告专家团协调者。请把数据准备、指标洞察、业务建议和报告草稿整合成一份可交付报告。
    最终内容必须区分事实、推断和建议；对缺失数据、样本偏差或口径不一致要明确说明。
  finalization:
    mode: deliverable
    member: reporter
    tools: [write, present_file, artifact]
    deliverable:
      required: true
      type: markdown
      title: 数据分析报告
      filename_template: data-analysis-report.md
      source: final_report
      presentation: both
      tools: [write, present_file, artifact]
  inputs:
    - name: analysis_goal
      description: 本次分析要回答的核心业务问题。
      required: true
    - name: metric_focus
      description: 重点关注的指标、维度或业务线；没有则留空。
      required: false
      default: ""
    - name: reporting_period
      description: 报告周期，例如本周、本月、Q2 或指定日期范围。
      required: false
      default: ""
  skills: [data-analysis, xlsx, charting, report]
  members:
    - id: data_preparer
      name: 数据准备
      role: 数据整理与口径检查专家
      goal: 读取附件和工作区数据，识别字段、口径、缺失值和可分析维度。
      role_ref: specialized/data-consolidation-agent
      tools: [read, glob, grep, search, code_execute, skill]
      skills: [data-analysis, xlsx]
      icon: database
    - id: analyst
      name: 指标分析
      role: 经营指标分析专家
      goal: 基于数据准备结果完成趋势、对比、异常和驱动因素分析。
      role_ref: support/support-analytics-reporter
      tools: [read, code_execute, skill]
      skills: [data-analysis, charting]
      icon: bar-chart-2
    - id: advisor
      name: 业务建议
      role: 业务洞察与行动建议专家
      goal: 将分析结果转成可执行建议、风险提醒和待确认问题。
      role_ref: finance/finance-financial-forecaster
      tools: [read, skill]
      skills: [report]
      icon: lightbulb
    - id: reporter
      name: 报告撰写
      role: 数据报告撰写与交付专家
      goal: 生成面向管理层或业务团队的结构化分析报告。
      role_ref: specialized/report-distribution-agent
      tools: [read, write, present_file, artifact, skill]
      skills: [report]
      icon: file-text
  tasks:
    - id: prepare_data
      name: 数据准备与口径检查
      member: data_preparer
      task: |
        请读取用户提供的附件和工作区材料，整理本次数据分析的可用信息。

        用户需求：
        {{user_input}}

        分析目标：
        {{analysis_goal}}

        重点指标：
        {{metric_focus}}

        报告周期：
        {{reporting_period}}

        请输出：数据来源、字段说明、可用维度、缺失或异常数据、口径风险、建议采用的分析方法。
      expected_output: 数据准备说明和口径检查结果。
      output: data_profile
      context_policy: explicit
      context_max_chars: 16000
      timeout_seconds: 300
      retry_count: 1
    - id: analyze_metrics
      name: 指标趋势与异常分析
      member: analyst
      depends_on: [prepare_data]
      context: [prepare_data]
      task: |
        基于数据准备结果完成指标分析。

        数据准备结果：
        {{data_profile}}

        请输出：核心指标变化、趋势、分组对比、异常点、可能原因、建议图表和需要谨慎解释的地方。
      expected_output: 指标分析结果。
      output: metric_insights
      context_policy: explicit
      context_max_chars: 20000
      timeout_seconds: 420
      retry_count: 1
    - id: recommend_actions
      name: 业务行动建议
      member: advisor
      depends_on: [prepare_data, analyze_metrics]
      context: [prepare_data, analyze_metrics]
      task: |
        将分析发现转化为业务建议。

        数据准备：
        {{data_profile}}

        指标洞察：
        {{metric_insights}}

        请输出：建议优先级、行动项、责任角色建议、风险提醒、需要补充确认的问题。
      expected_output: 业务建议和风险提醒。
      output: business_recommendations
      context_policy: explicit
      context_max_chars: 22000
      timeout_seconds: 300
      retry_count: 1
    - id: write_report
      name: 生成分析报告
      member: reporter
      depends_on: [prepare_data, analyze_metrics, recommend_actions]
      context: [prepare_data, analyze_metrics, recommend_actions]
      task: |
        生成最终数据分析报告。

        数据准备：
        {{data_profile}}

        指标洞察：
        {{metric_insights}}

        业务建议：
        {{business_recommendations}}

        报告必须包含：摘要、数据口径、关键发现、异常与解释、建议行动、风险和待确认问题。
      expected_output: 可交付的数据分析报告。
      output: final_report
      context_policy: explicit
      context_max_chars: 32000
      timeout_seconds: 300
      retry_count: 1
```

- [ ] **Step 2: Run the targeted validation**

Run:

```bash
cd backend && ./.venv/bin/python - <<'PY'
from pathlib import Path
from app.expert.registry import ExpertTeamRegistry
from app.expert.validation import validate_expert_team_config
registry = ExpertTeamRegistry(presets_dir=Path("app/expert/presets"))
registry.scan()
team = registry.get_or_raise("data-analysis-report")
errors = validate_expert_team_config(team)
print(errors)
raise SystemExit(1 if errors else 0)
PY
```

Expected: prints `[]` and exits 0.

---

### Task 3: Add Meeting Notes and Actions Preset

**Files:**
- Create: `backend/app/expert/presets/meeting_notes_actions.yaml`
- Test: `backend/tests/test_expert/test_preset_registry.py`

- [ ] **Step 1: Create `meeting_notes_actions.yaml`**

Create the file with:

```yaml
team:
  id: meeting-notes-actions
  name: 会议纪要与行动项专家团
  description: 将会议记录、转写稿或聊天记录整理成纪要、决策、行动项和会后跟进邮件。
  icon: file-text
  category: 办公文档
  tags: [会议纪要, 行动项, 决策记录, 跟进邮件]
  version: "1.0"
  process: workflow
  concurrency: 2
  default_max_tool_rounds: 6
  interaction_mode: auto
  max_clarifying_questions: 4
  question_timeout_seconds: 300
  on_question_timeout: continue_with_assumptions
  expert_output_style: concise
  expert_visible_max_chars: 1800
  coordinator_visible_max_chars: 2400
  coordinator_context_policy: summary
  coordinator_context_max_chars: 32000
  coordinator_prompt: |
    你是会议纪要专家团协调者。请保证最终纪要准确、可追责、便于会后执行。
    不确定的发言人、时间点或责任人必须标记为待确认，不要编造。
  finalization:
    mode: deliverable
    member: coordinator
    tools: [write, present_file, artifact]
    deliverable:
      required: true
      type: markdown
      title: 会议纪要与行动项
      filename_template: meeting-notes-actions.md
      source: final_minutes
      presentation: both
      tools: [write, present_file, artifact]
  inputs:
    - name: meeting_topic
      description: 会议主题。
      required: true
    - name: meeting_date
      description: 会议日期；未知可留空。
      required: false
      default: ""
    - name: audience
      description: 纪要读者，例如项目组、管理层、客户。
      required: false
      default: 项目组
  skills: [meeting-notes, email, report]
  members:
    - id: extractor
      name: 信息提取
      role: 会议内容提取专家
      goal: 从会议材料中提取议题、关键讨论、决策和争议点。
      role_ref: specialized/specialized-meeting-assistant
      tools: [read, glob, grep, search, skill]
      skills: [meeting-notes]
      icon: search
    - id: action_owner
      name: 行动项整理
      role: 任务拆解与责任追踪专家
      goal: 将会议结论转成明确行动项、负责人、截止时间和依赖关系。
      role_ref: project-management/project-manager-senior
      tools: [read, skill]
      skills: [project-planning]
      icon: check-circle
    - id: communicator
      name: 跟进沟通
      role: 会后沟通与邮件专家
      goal: 生成清晰、得体、可发送的会后跟进内容。
      role_ref: specialized/report-distribution-agent
      tools: [read, skill]
      skills: [email]
      icon: mail
    - id: coordinator
      name: 纪要交付
      role: 会议纪要编辑与交付专家
      goal: 汇总形成最终会议纪要、行动项表和跟进邮件草稿。
      role_ref: specialized/specialized-document-generator
      tools: [read, write, present_file, artifact, skill]
      skills: [meeting-notes, report]
      icon: file-text
  tasks:
    - id: extract_minutes
      name: 提取会议要点
      member: extractor
      task: |
        请基于会议材料提取结构化信息。

        用户需求：
        {{user_input}}

        会议主题：
        {{meeting_topic}}

        会议日期：
        {{meeting_date}}

        读者：
        {{audience}}

        输出必须包含：议题、重要讨论、已确认决策、分歧或待确认问题、原文证据摘要。
      expected_output: 会议要点和决策记录。
      output: meeting_extract
      context_policy: explicit
      context_max_chars: 18000
      timeout_seconds: 300
      retry_count: 1
    - id: action_items
      name: 整理行动项
      member: action_owner
      depends_on: [extract_minutes]
      context: [extract_minutes]
      task: |
        将会议要点转成行动项。

        会议提取结果：
        {{meeting_extract}}

        输出必须包含：行动项、负责人、截止时间、依赖关系、优先级、待确认责任人。
      expected_output: 行动项清单。
      output: action_list
      context_policy: explicit
      context_max_chars: 16000
      timeout_seconds: 240
      retry_count: 1
    - id: follow_up
      name: 生成跟进邮件
      member: communicator
      depends_on: [extract_minutes, action_items]
      context: [extract_minutes, action_items]
      task: |
        生成会后跟进邮件草稿。

        会议要点：
        {{meeting_extract}}

        行动项：
        {{action_list}}

        邮件要简洁、礼貌、可发送，突出决策、行动项和需要回复确认的问题。
      expected_output: 会后跟进邮件草稿。
      output: follow_up_email
      context_policy: explicit
      context_max_chars: 18000
      timeout_seconds: 240
      retry_count: 1
    - id: final_minutes
      name: 生成最终纪要
      member: coordinator
      depends_on: [extract_minutes, action_items, follow_up]
      context: [extract_minutes, action_items, follow_up]
      task: |
        生成最终会议纪要与行动项文档。

        会议要点：
        {{meeting_extract}}

        行动项：
        {{action_list}}

        跟进邮件：
        {{follow_up_email}}

        文档必须包含：会议信息、摘要、讨论要点、决策、行动项表格、待确认问题、跟进邮件草稿。
      expected_output: 会议纪要与行动项最终文档。
      output: final_minutes
      context_policy: explicit
      context_max_chars: 26000
      timeout_seconds: 300
      retry_count: 1
```

- [ ] **Step 2: Run targeted validation**

Run:

```bash
cd backend && ./.venv/bin/python - <<'PY'
from pathlib import Path
from app.expert.registry import ExpertTeamRegistry
from app.expert.validation import validate_expert_team_config
registry = ExpertTeamRegistry(presets_dir=Path("app/expert/presets"))
registry.scan()
team = registry.get_or_raise("meeting-notes-actions")
errors = validate_expert_team_config(team)
print(errors)
raise SystemExit(1 if errors else 0)
PY
```

Expected: prints `[]` and exits 0.

---

### Task 4: Add Weekly and Monthly Report Preset

**Files:**
- Create: `backend/app/expert/presets/weekly_monthly_report.yaml`
- Test: `backend/tests/test_expert/test_preset_registry.py`

- [ ] **Step 1: Create `weekly_monthly_report.yaml`**

Create the file with:

```yaml
team:
  id: weekly-monthly-report
  name: 周报/月报生成专家团
  description: 从工作记录、项目资料、会议纪要或工作区文件中汇总进展、风险、计划和管理层摘要。
  icon: calendar
  category: 办公文档
  tags: [周报, 月报, 项目汇报, 进展总结]
  version: "1.0"
  process: workflow
  concurrency: 2
  default_max_tool_rounds: 7
  interaction_mode: auto
  max_clarifying_questions: 4
  question_timeout_seconds: 300
  on_question_timeout: continue_with_assumptions
  expert_output_style: concise
  expert_visible_max_chars: 1800
  coordinator_visible_max_chars: 2400
  coordinator_context_policy: summary
  coordinator_context_max_chars: 36000
  coordinator_prompt: |
    你是周报/月报专家团协调者。最终报告必须重点突出、事实可追溯、风险和下周计划清晰。
    不要把未确认事项写成已完成事项。
  finalization:
    mode: deliverable
    member: writer
    tools: [write, present_file, artifact]
    deliverable:
      required: true
      type: markdown
      title: 周报/月报
      filename_template: work-report.md
      source: final_work_report
      presentation: both
      tools: [write, present_file, artifact]
  inputs:
    - name: report_type
      description: 报告类型。
      required: false
      default: 周报
      options:
        - label: 周报
          value: 周报
        - label: 月报
          value: 月报
    - name: report_period
      description: 报告周期，例如 2026-06-01 至 2026-06-07。
      required: false
      default: ""
    - name: audience
      description: 目标读者，例如直属领导、项目组、客户。
      required: false
      default: 直属领导
  skills: [document-summary, report, project-planning]
  members:
    - id: collector
      name: 资料汇总
      role: 工作记录与资料汇总专家
      goal: 从用户输入、附件和工作区中提取本周期工作事实。
      role_ref: specialized/data-consolidation-agent
      tools: [read, glob, grep, search, skill]
      skills: [document-summary]
      icon: folder
    - id: project_reviewer
      name: 进展评估
      role: 项目进展与风险评估专家
      goal: 识别完成事项、延期事项、阻塞风险和依赖。
      role_ref: project-management/project-manager-senior
      tools: [read, skill]
      skills: [project-planning]
      icon: workflow
    - id: writer
      name: 报告撰写
      role: 工作报告撰写专家
      goal: 生成适合目标读者的周报或月报。
      role_ref: support/support-executive-summary-generator
      tools: [read, write, present_file, artifact, skill]
      skills: [report]
      icon: file-text
  tasks:
    - id: collect_facts
      name: 汇总工作事实
      member: collector
      task: |
        请从用户输入、附件和工作区资料中汇总本周期工作事实。

        用户需求：
        {{user_input}}

        报告类型：
        {{report_type}}

        报告周期：
        {{report_period}}

        目标读者：
        {{audience}}

        输出必须包含：已完成工作、进行中事项、数据或证据、会议/沟通摘要、无法确认的信息。
      expected_output: 本周期工作事实清单。
      output: work_facts
      context_policy: explicit
      context_max_chars: 22000
      timeout_seconds: 300
      retry_count: 1
    - id: assess_progress
      name: 评估进展与风险
      member: project_reviewer
      depends_on: [collect_facts]
      context: [collect_facts]
      task: |
        基于工作事实评估项目进展和风险。

        工作事实：
        {{work_facts}}

        输出必须包含：关键进展、延期或阻塞、风险等级、需要协调的资源、下周期建议重点。
      expected_output: 进展和风险评估。
      output: progress_risks
      context_policy: explicit
      context_max_chars: 20000
      timeout_seconds: 240
      retry_count: 1
    - id: write_report
      name: 撰写周报/月报
      member: writer
      depends_on: [collect_facts, assess_progress]
      context: [collect_facts, assess_progress]
      task: |
        生成最终{{report_type}}。

        工作事实：
        {{work_facts}}

        进展风险：
        {{progress_risks}}

        报告必须包含：一句话摘要、本周期完成、关键数据、问题与风险、下周期计划、需领导/团队支持事项。
      expected_output: 最终周报或月报。
      output: final_work_report
      context_policy: explicit
      context_max_chars: 26000
      timeout_seconds: 300
      retry_count: 1
```

- [ ] **Step 2: Run targeted validation**

Run:

```bash
cd backend && ./.venv/bin/python - <<'PY'
from pathlib import Path
from app.expert.registry import ExpertTeamRegistry
from app.expert.validation import validate_expert_team_config
registry = ExpertTeamRegistry(presets_dir=Path("app/expert/presets"))
registry.scan()
team = registry.get_or_raise("weekly-monthly-report")
errors = validate_expert_team_config(team)
print(errors)
raise SystemExit(1 if errors else 0)
PY
```

Expected: prints `[]` and exits 0.

---

### Task 5: Add Document Review and Polish Preset

**Files:**
- Create: `backend/app/expert/presets/document_review_polish.yaml`
- Test: `backend/tests/test_expert/test_preset_registry.py`

- [ ] **Step 1: Create `document_review_polish.yaml`**

Create the file with:

```yaml
team:
  id: document-review-polish
  name: 文档总结与审校专家团
  description: 对方案、制度、报告、合同草稿或长文档进行摘要、结构审查、风险检查和润色改写。
  icon: file-check
  category: 办公文档
  tags: [文档总结, 审校, 润色, 风险检查]
  version: "1.0"
  process: workflow
  concurrency: 2
  default_max_tool_rounds: 7
  interaction_mode: auto
  max_clarifying_questions: 4
  question_timeout_seconds: 300
  on_question_timeout: continue_with_assumptions
  expert_output_style: concise
  expert_visible_max_chars: 1800
  coordinator_visible_max_chars: 2400
  coordinator_context_policy: summary
  coordinator_context_max_chars: 36000
  coordinator_prompt: |
    你是文档审校专家团协调者。最终结果要兼顾准确摘要、结构改进、风险提示和可直接使用的修改稿。
    对法律、财务、合规等高风险结论必须标注为审阅建议，不替代专业意见。
  finalization:
    mode: deliverable
    member: editor
    tools: [write, present_file, artifact]
    deliverable:
      required: true
      type: markdown
      title: 文档审校报告
      filename_template: document-review-polish.md
      source: final_review
      presentation: both
      tools: [write, present_file, artifact]
  inputs:
    - name: document_goal
      description: 文档目标或希望审校的重点。
      required: true
    - name: target_audience
      description: 文档目标读者。
      required: false
      default: 内部团队
    - name: tone
      description: 期望语气，例如正式、简洁、商务、面向客户。
      required: false
      default: 正式简洁
  skills: [document-summary, doc-coauthoring, report]
  members:
    - id: summarizer
      name: 文档摘要
      role: 长文档理解与摘要专家
      goal: 提取文档主旨、结构、关键事实和缺失信息。
      role_ref: specialized/specialized-document-generator
      tools: [read, glob, grep, search, skill]
      skills: [document-summary]
      icon: file-text
    - id: structure_reviewer
      name: 结构审查
      role: 文档结构与表达审查专家
      goal: 检查逻辑结构、论证完整性、读者匹配度和表达问题。
      role_ref: engineering/engineering-technical-writer
      tools: [read, skill]
      skills: [doc-coauthoring]
      icon: list-checks
    - id: risk_reviewer
      name: 风险检查
      role: 风险与合规审阅专家
      goal: 识别模糊承诺、事实缺口、合规风险和需要人工确认的内容。
      role_ref: legal/legal-policy-writer
      tools: [read, skill]
      skills: [document-summary]
      icon: shield
    - id: editor
      name: 润色交付
      role: 文档润色与最终交付专家
      goal: 生成审校报告和可复用的修改建议或改写稿。
      role_ref: specialized/specialized-document-generator
      tools: [read, write, present_file, artifact, skill]
      skills: [doc-coauthoring, report]
      icon: pen-tool
  tasks:
    - id: summarize_document
      name: 总结文档
      member: summarizer
      task: |
        请阅读用户提供的文档、附件或工作区资料，提取摘要。

        用户需求：
        {{user_input}}

        文档目标：
        {{document_goal}}

        目标读者：
        {{target_audience}}

        输出必须包含：文档主旨、结构提纲、关键事实、关键结论、明显缺失信息。
      expected_output: 文档摘要和事实提取。
      output: document_summary
      context_policy: explicit
      context_max_chars: 22000
      timeout_seconds: 300
      retry_count: 1
    - id: review_structure
      name: 审查结构与表达
      member: structure_reviewer
      depends_on: [summarize_document]
      context: [summarize_document]
      task: |
        审查文档结构和表达质量。

        文档摘要：
        {{document_summary}}

        期望语气：
        {{tone}}

        输出必须包含：结构问题、逻辑跳跃、冗余内容、表达不清、建议调整顺序。
      expected_output: 结构与表达审查意见。
      output: structure_review
      context_policy: explicit
      context_max_chars: 18000
      timeout_seconds: 240
      retry_count: 1
    - id: review_risks
      name: 检查风险与待确认项
      member: risk_reviewer
      depends_on: [summarize_document]
      context: [summarize_document]
      task: |
        识别文档中的风险和待确认内容。

        文档摘要：
        {{document_summary}}

        输出必须包含：事实风险、合规或法律风险、过度承诺、缺少依据的判断、需要人工确认的问题。
      expected_output: 风险和待确认问题清单。
      output: risk_review
      context_policy: explicit
      context_max_chars: 18000
      timeout_seconds: 240
      retry_count: 1
    - id: final_review
      name: 生成审校报告
      member: editor
      depends_on: [summarize_document, review_structure, review_risks]
      context: [summarize_document, review_structure, review_risks]
      task: |
        生成最终文档审校报告。

        文档摘要：
        {{document_summary}}

        结构审查：
        {{structure_review}}

        风险检查：
        {{risk_review}}

        报告必须包含：摘要、主要问题、逐条修改建议、风险提示、建议改写片段和待确认问题。
      expected_output: 文档审校报告。
      output: final_review
      context_policy: explicit
      context_max_chars: 30000
      timeout_seconds: 300
      retry_count: 1
```

- [ ] **Step 2: Run targeted validation**

Run:

```bash
cd backend && ./.venv/bin/python - <<'PY'
from pathlib import Path
from app.expert.registry import ExpertTeamRegistry
from app.expert.validation import validate_expert_team_config
registry = ExpertTeamRegistry(presets_dir=Path("app/expert/presets"))
registry.scan()
team = registry.get_or_raise("document-review-polish")
errors = validate_expert_team_config(team)
print(errors)
raise SystemExit(1 if errors else 0)
PY
```

Expected: prints `[]` and exits 0.

---

### Task 6: Add Presentation Briefing Preset

**Files:**
- Create: `backend/app/expert/presets/presentation_briefing.yaml`
- Test: `backend/tests/test_expert/test_preset_registry.py`

- [ ] **Step 1: Create `presentation_briefing.yaml`**

Create the file with:

```yaml
team:
  id: presentation-briefing
  name: PPT/汇报材料专家团
  description: 将资料、报告或零散想法转成汇报逻辑、PPT 大纲、演讲稿和视觉建议。
  icon: presentation
  category: 办公文档
  tags: [PPT, 汇报, 演示, 大纲, 演讲稿]
  version: "1.0"
  process: workflow
  concurrency: 2
  default_max_tool_rounds: 7
  interaction_mode: auto
  max_clarifying_questions: 4
  question_timeout_seconds: 300
  on_question_timeout: continue_with_assumptions
  expert_output_style: concise
  expert_visible_max_chars: 1800
  coordinator_visible_max_chars: 2400
  coordinator_context_policy: summary
  coordinator_context_max_chars: 36000
  coordinator_prompt: |
    你是汇报材料专家团协调者。最终交付要能直接指导制作 PPT：逻辑清楚、页页有目的、重点突出。
  finalization:
    mode: deliverable
    member: deck_writer
    tools: [write, present_file, artifact]
    deliverable:
      required: true
      type: markdown
      title: 汇报材料方案
      filename_template: presentation-briefing.md
      source: final_deck_brief
      presentation: both
      tools: [write, present_file, artifact]
  inputs:
    - name: presentation_goal
      description: 本次汇报要达成的目标。
      required: true
    - name: audience
      description: 汇报对象，例如老板、客户、项目评审会。
      required: true
    - name: slide_count
      description: 期望页数；未知可留空。
      required: false
      default: ""
  skills: [presentation, pptx, report]
  members:
    - id: content_strategist
      name: 汇报策略
      role: 汇报逻辑与内容策略专家
      goal: 明确汇报目标、受众关注点和主线叙事。
      role_ref: project-management/project-manager-senior
      tools: [read, glob, grep, search, skill]
      skills: [presentation]
      icon: target
    - id: deck_architect
      name: 结构设计
      role: PPT 结构与页面规划专家
      goal: 将材料拆成页级结构、标题和核心信息。
      role_ref: design/design-visual-storyteller
      tools: [read, skill]
      skills: [presentation, pptx]
      icon: layers
    - id: speaker_coach
      name: 演讲稿
      role: 汇报话术与答辩准备专家
      goal: 为关键页生成讲述话术和可能问答。
      role_ref: support/support-executive-summary-generator
      tools: [read, skill]
      skills: [presentation]
      icon: mic
    - id: deck_writer
      name: 材料交付
      role: 汇报材料撰写与交付专家
      goal: 生成可直接制作 PPT 的大纲、页面内容和演讲提示。
      role_ref: specialized/specialized-document-generator
      tools: [read, write, present_file, artifact, skill]
      skills: [presentation, pptx, report]
      icon: file-text
  tasks:
    - id: define_storyline
      name: 确定汇报主线
      member: content_strategist
      task: |
        请基于用户材料确定汇报主线。

        用户需求：
        {{user_input}}

        汇报目标：
        {{presentation_goal}}

        汇报对象：
        {{audience}}

        期望页数：
        {{slide_count}}

        输出必须包含：受众关注点、核心结论、主线结构、必须呈现的数据或证据、风险点。
      expected_output: 汇报主线和内容策略。
      output: storyline
      context_policy: explicit
      context_max_chars: 22000
      timeout_seconds: 300
      retry_count: 1
    - id: plan_slides
      name: 规划页面结构
      member: deck_architect
      depends_on: [define_storyline]
      context: [define_storyline]
      task: |
        将汇报主线拆成 PPT 页级结构。

        汇报主线：
        {{storyline}}

        输出每一页的：页码、标题、核心信息、建议图表/视觉、所需素材、备注。
      expected_output: PPT 页级结构。
      output: slide_plan
      context_policy: explicit
      context_max_chars: 22000
      timeout_seconds: 300
      retry_count: 1
    - id: speaker_notes
      name: 生成讲述话术
      member: speaker_coach
      depends_on: [define_storyline, plan_slides]
      context: [define_storyline, plan_slides]
      task: |
        为关键页面生成讲述话术和答疑准备。

        汇报主线：
        {{storyline}}

        页面规划：
        {{slide_plan}}

        输出必须包含：开场话术、每页讲述重点、可能问题、回答建议。
      expected_output: 演讲稿和答疑准备。
      output: talk_track
      context_policy: explicit
      context_max_chars: 24000
      timeout_seconds: 240
      retry_count: 1
    - id: final_deck_brief
      name: 生成汇报材料方案
      member: deck_writer
      depends_on: [define_storyline, plan_slides, speaker_notes]
      context: [define_storyline, plan_slides, speaker_notes]
      task: |
        生成最终汇报材料方案。

        汇报主线：
        {{storyline}}

        页面规划：
        {{slide_plan}}

        讲述话术：
        {{talk_track}}

        最终文档必须包含：汇报摘要、PPT 大纲、逐页内容、视觉建议、演讲提示、待补素材。
      expected_output: 汇报材料方案。
      output: final_deck_brief
      context_policy: explicit
      context_max_chars: 32000
      timeout_seconds: 300
      retry_count: 1
```

- [ ] **Step 2: Run targeted validation**

Run:

```bash
cd backend && ./.venv/bin/python - <<'PY'
from pathlib import Path
from app.expert.registry import ExpertTeamRegistry
from app.expert.validation import validate_expert_team_config
registry = ExpertTeamRegistry(presets_dir=Path("app/expert/presets"))
registry.scan()
team = registry.get_or_raise("presentation-briefing")
errors = validate_expert_team_config(team)
print(errors)
raise SystemExit(1 if errors else 0)
PY
```

Expected: prints `[]` and exits 0.

---

### Task 7: Add Research and Competitive Analysis Preset

**Files:**
- Create: `backend/app/expert/presets/research_competitive_analysis.yaml`
- Test: `backend/tests/test_expert/test_preset_registry.py`

- [ ] **Step 1: Create `research_competitive_analysis.yaml`**

Create the file with:

```yaml
team:
  id: research-competitive-analysis
  name: 研究与竞品分析专家团
  description: 围绕市场、竞品、政策、产品或行业问题进行资料研究、竞品对比和决策建议输出。
  icon: search
  category: 研究咨询
  tags: [研究, 竞品分析, 市场分析, 决策建议]
  version: "1.0"
  process: workflow
  concurrency: 3
  default_max_tool_rounds: 8
  interaction_mode: auto
  max_clarifying_questions: 4
  question_timeout_seconds: 300
  on_question_timeout: continue_with_assumptions
  expert_output_style: concise
  expert_visible_max_chars: 1800
  coordinator_visible_max_chars: 2600
  coordinator_context_policy: summary
  coordinator_context_max_chars: 42000
  coordinator_prompt: |
    你是研究与竞品分析专家团协调者。最终报告必须区分来源事实、分析判断和建议。
    如果信息来自用户材料而非联网检索，也要说明来源边界。
  finalization:
    mode: deliverable
    member: synthesizer
    tools: [write, present_file, artifact]
    deliverable:
      required: true
      type: markdown
      title: 研究与竞品分析报告
      filename_template: research-competitive-analysis.md
      source: final_research_report
      presentation: both
      tools: [write, present_file, artifact]
  inputs:
    - name: research_question
      description: 本次研究要回答的问题。
      required: true
    - name: target_market
      description: 市场、区域、行业或目标用户。
      required: false
      default: ""
    - name: competitors
      description: 已知竞品或对比对象；没有则留空。
      required: false
      default: ""
  skills: [research, report, charting]
  members:
    - id: researcher
      name: 资料研究
      role: 市场与资料研究专家
      goal: 收集并整理与研究问题相关的事实、来源和背景。
      role_ref: product/product-trend-researcher
      tools: [read, glob, grep, search, web_search, web_fetch, skill]
      skills: [research]
      icon: search
    - id: competitor_analyst
      name: 竞品对比
      role: 竞品与产品对比专家
      goal: 对比竞品定位、功能、价格、优势、短板和差异化机会。
      role_ref: product/product-feedback-synthesizer
      tools: [read, web_search, web_fetch, skill]
      skills: [research]
      icon: columns
    - id: strategy_advisor
      name: 策略建议
      role: 机会风险与策略建议专家
      goal: 从研究和竞品结果中提炼机会、风险、进入策略和下一步验证。
      role_ref: specialized/specialized-risk-assessor
      tools: [read, skill]
      skills: [report]
      icon: lightbulb
    - id: synthesizer
      name: 报告交付
      role: 研究报告撰写专家
      goal: 生成结构化研究报告和对比表。
      role_ref: support/support-executive-summary-generator
      tools: [read, write, present_file, artifact, skill]
      skills: [report, charting]
      icon: file-text
  tasks:
    - id: gather_research
      name: 收集研究资料
      member: researcher
      task: |
        围绕研究问题收集并整理资料。

        用户需求：
        {{user_input}}

        研究问题：
        {{research_question}}

        目标市场：
        {{target_market}}

        已知竞品：
        {{competitors}}

        输出必须包含：关键事实、来源摘要、行业/市场背景、证据强弱、信息缺口。
      expected_output: 研究资料和来源摘要。
      output: research_findings
      context_policy: explicit
      context_max_chars: 24000
      timeout_seconds: 420
      retry_count: 1
    - id: compare_competitors
      name: 竞品对比分析
      member: competitor_analyst
      depends_on: [gather_research]
      context: [gather_research]
      task: |
        基于研究资料完成竞品对比。

        研究资料：
        {{research_findings}}

        输出必须包含：竞品列表、定位、核心能力、价格/商业模式、优劣势、差异化机会、对比表。
      expected_output: 竞品对比分析。
      output: competitor_comparison
      context_policy: explicit
      context_max_chars: 26000
      timeout_seconds: 360
      retry_count: 1
    - id: strategic_options
      name: 提炼机会与风险
      member: strategy_advisor
      depends_on: [gather_research, compare_competitors]
      context: [gather_research, compare_competitors]
      task: |
        提炼策略机会、风险和建议。

        研究资料：
        {{research_findings}}

        竞品对比：
        {{competitor_comparison}}

        输出必须包含：机会、威胁、风险等级、建议策略、验证实验、待确认假设。
      expected_output: 策略建议和风险判断。
      output: strategy_options
      context_policy: explicit
      context_max_chars: 26000
      timeout_seconds: 300
      retry_count: 1
    - id: final_report
      name: 生成研究报告
      member: synthesizer
      depends_on: [gather_research, compare_competitors, strategic_options]
      context: [gather_research, compare_competitors, strategic_options]
      task: |
        生成最终研究与竞品分析报告。

        研究资料：
        {{research_findings}}

        竞品对比：
        {{competitor_comparison}}

        策略建议：
        {{strategy_options}}

        报告必须包含：执行摘要、背景、竞品对比表、机会风险、建议路线、信息来源边界、待验证问题。
      expected_output: 研究与竞品分析报告。
      output: final_research_report
      context_policy: explicit
      context_max_chars: 36000
      timeout_seconds: 360
      retry_count: 1
```

- [ ] **Step 2: Run targeted validation**

Run:

```bash
cd backend && ./.venv/bin/python - <<'PY'
from pathlib import Path
from app.expert.registry import ExpertTeamRegistry
from app.expert.validation import validate_expert_team_config
registry = ExpertTeamRegistry(presets_dir=Path("app/expert/presets"))
registry.scan()
team = registry.get_or_raise("research-competitive-analysis")
errors = validate_expert_team_config(team)
print(errors)
raise SystemExit(1 if errors else 0)
PY
```

Expected: prints `[]` and exits 0.

---

### Task 8: Add Sales Proposal Preset

**Files:**
- Create: `backend/app/expert/presets/sales_proposal.yaml`
- Test: `backend/tests/test_expert/test_preset_registry.py`

- [ ] **Step 1: Create `sales_proposal.yaml`**

Create the file with:

```yaml
team:
  id: sales-proposal
  name: 客户提案与销售方案专家团
  description: 根据客户背景、需求、产品资料和约束生成客户提案、价值主张、实施路径和跟进话术。
  icon: briefcase
  category: 研究咨询
  tags: [销售提案, 客户方案, 售前, 跟进话术]
  version: "1.0"
  process: workflow
  concurrency: 2
  default_max_tool_rounds: 7
  interaction_mode: auto
  max_clarifying_questions: 4
  question_timeout_seconds: 300
  on_question_timeout: continue_with_assumptions
  expert_output_style: concise
  expert_visible_max_chars: 1800
  coordinator_visible_max_chars: 2600
  coordinator_context_policy: summary
  coordinator_context_max_chars: 36000
  coordinator_prompt: |
    你是客户提案专家团协调者。最终方案必须从客户痛点出发，避免空泛卖点。
    对未确认的客户信息和商业假设要列为待确认。
  finalization:
    mode: deliverable
    member: proposal_writer
    tools: [write, present_file, artifact]
    deliverable:
      required: true
      type: markdown
      title: 客户提案与销售方案
      filename_template: sales-proposal.md
      source: final_proposal
      presentation: both
      tools: [write, present_file, artifact]
  inputs:
    - name: customer_name
      description: 客户或目标账号名称。
      required: false
      default: ""
    - name: proposal_goal
      description: 提案目标，例如初次沟通、正式投标、续约、增购。
      required: true
    - name: offering
      description: 要推荐的产品、服务或方案。
      required: true
  skills: [research, report, email]
  members:
    - id: account_researcher
      name: 客户研究
      role: 客户背景与需求研究专家
      goal: 汇总客户背景、业务场景、痛点、利益相关方和信息缺口。
      role_ref: sales/sales-account-strategist
      tools: [read, glob, grep, search, web_search, web_fetch, skill]
      skills: [research]
      icon: search
    - id: solution_architect
      name: 方案设计
      role: 售前解决方案专家
      goal: 将客户需求映射为产品能力、实施路径、里程碑和价值指标。
      role_ref: sales/sales-engineer
      tools: [read, skill]
      skills: [report]
      icon: workflow
    - id: deal_strategist
      name: 销售策略
      role: 销售策略与风险专家
      goal: 识别成交障碍、竞争风险、谈判策略和下一步行动。
      role_ref: sales/sales-proposal-strategist
      tools: [read, skill]
      skills: [email]
      icon: target
    - id: proposal_writer
      name: 提案交付
      role: 客户提案撰写专家
      goal: 生成客户可读、可沟通、可执行的提案和跟进话术。
      role_ref: sales/sales-proposal-strategist
      tools: [read, write, present_file, artifact, skill]
      skills: [report, email]
      icon: file-text
  tasks:
    - id: customer_context
      name: 客户背景与痛点
      member: account_researcher
      task: |
        请整理客户背景、需求和痛点。

        用户需求：
        {{user_input}}

        客户名称：
        {{customer_name}}

        提案目标：
        {{proposal_goal}}

        推荐内容：
        {{offering}}

        输出必须包含：客户背景、关键痛点、业务目标、利益相关方、已知约束、待确认信息。
      expected_output: 客户背景和需求画像。
      output: customer_context
      context_policy: explicit
      context_max_chars: 22000
      timeout_seconds: 360
      retry_count: 1
    - id: solution_plan
      name: 设计解决方案
      member: solution_architect
      depends_on: [customer_context]
      context: [customer_context]
      task: |
        基于客户背景设计解决方案。

        客户背景：
        {{customer_context}}

        输出必须包含：价值主张、方案模块、实施步骤、成功指标、所需资源、边界条件。
      expected_output: 客户解决方案设计。
      output: solution_plan
      context_policy: explicit
      context_max_chars: 24000
      timeout_seconds: 300
      retry_count: 1
    - id: sales_strategy
      name: 制定销售策略
      member: deal_strategist
      depends_on: [customer_context, solution_plan]
      context: [customer_context, solution_plan]
      task: |
        制定销售沟通和推进策略。

        客户背景：
        {{customer_context}}

        解决方案：
        {{solution_plan}}

        输出必须包含：关键卖点、可能异议、应对话术、竞争风险、下一步跟进计划。
      expected_output: 销售策略和跟进建议。
      output: sales_strategy
      context_policy: explicit
      context_max_chars: 26000
      timeout_seconds: 300
      retry_count: 1
    - id: final_proposal
      name: 生成客户提案
      member: proposal_writer
      depends_on: [customer_context, solution_plan, sales_strategy]
      context: [customer_context, solution_plan, sales_strategy]
      task: |
        生成最终客户提案与跟进话术。

        客户背景：
        {{customer_context}}

        解决方案：
        {{solution_plan}}

        销售策略：
        {{sales_strategy}}

        文档必须包含：执行摘要、客户痛点、方案价值、实施路径、成功指标、风险假设、下一步行动、跟进邮件草稿。
      expected_output: 客户提案与销售方案。
      output: final_proposal
      context_policy: explicit
      context_max_chars: 32000
      timeout_seconds: 300
      retry_count: 1
```

- [ ] **Step 2: Run targeted validation**

Run:

```bash
cd backend && ./.venv/bin/python - <<'PY'
from pathlib import Path
from app.expert.registry import ExpertTeamRegistry
from app.expert.validation import validate_expert_team_config
registry = ExpertTeamRegistry(presets_dir=Path("app/expert/presets"))
registry.scan()
team = registry.get_or_raise("sales-proposal")
errors = validate_expert_team_config(team)
print(errors)
raise SystemExit(1 if errors else 0)
PY
```

Expected: prints `[]` and exits 0.

---

### Task 9: Add Project Plan and Risk Preset

**Files:**
- Create: `backend/app/expert/presets/project_plan_risk.yaml`
- Test: `backend/tests/test_expert/test_preset_registry.py`

- [ ] **Step 1: Create `project_plan_risk.yaml`**

Create the file with:

```yaml
team:
  id: project-plan-risk
  name: 项目计划与风险评审专家团
  description: 将目标或需求拆解为项目计划、里程碑、任务分工、风险清单和推进建议。
  icon: workflow
  category: 研究咨询
  tags: [项目计划, 风险评审, 里程碑, 任务拆解]
  version: "1.0"
  process: workflow
  concurrency: 2
  default_max_tool_rounds: 7
  interaction_mode: auto
  max_clarifying_questions: 4
  question_timeout_seconds: 300
  on_question_timeout: continue_with_assumptions
  expert_output_style: concise
  expert_visible_max_chars: 1800
  coordinator_visible_max_chars: 2600
  coordinator_context_policy: summary
  coordinator_context_max_chars: 36000
  coordinator_prompt: |
    你是项目计划与风险评审专家团协调者。最终计划必须可执行、边界清楚、风险明确。
    对缺少资源、时间、负责人或验收标准的信息要列为待确认。
  finalization:
    mode: deliverable
    member: planner
    tools: [write, present_file, artifact]
    deliverable:
      required: true
      type: markdown
      title: 项目计划与风险评审
      filename_template: project-plan-risk.md
      source: final_project_plan
      presentation: both
      tools: [write, present_file, artifact]
  inputs:
    - name: project_goal
      description: 项目目标。
      required: true
    - name: deadline
      description: 截止时间或重要里程碑；未知可留空。
      required: false
      default: ""
    - name: constraints
      description: 资源、预算、人员、范围或技术限制。
      required: false
      default: ""
  skills: [project-planning, report]
  members:
    - id: planner
      name: 项目规划
      role: 项目计划与里程碑专家
      goal: 将目标拆解为阶段、任务、里程碑、依赖和交付物。
      role_ref: project-management/project-manager-senior
      tools: [read, glob, grep, search, write, present_file, artifact, skill]
      skills: [project-planning, report]
      icon: workflow
    - id: risk_reviewer
      name: 风险评审
      role: 项目风险与依赖评审专家
      goal: 识别计划风险、资源缺口、依赖阻塞和验收风险。
      role_ref: specialized/specialized-risk-assessor
      tools: [read, skill]
      skills: [project-planning]
      icon: shield
    - id: execution_advisor
      name: 推进建议
      role: 项目推进与协作机制专家
      goal: 给出沟通节奏、责任分工、会议机制和下一步行动。
      role_ref: project-management/project-management-project-shepherd
      tools: [read, skill]
      skills: [project-planning]
      icon: users
  tasks:
    - id: define_scope
      name: 明确范围与目标
      member: planner
      task: |
        请根据用户输入明确项目范围。

        用户需求：
        {{user_input}}

        项目目标：
        {{project_goal}}

        截止时间：
        {{deadline}}

        约束条件：
        {{constraints}}

        输出必须包含：项目目标、范围内/范围外事项、关键交付物、验收标准、待确认信息。
      expected_output: 项目范围和目标定义。
      output: project_scope
      context_policy: explicit
      context_max_chars: 18000
      timeout_seconds: 300
      retry_count: 1
    - id: build_plan
      name: 制定项目计划
      member: planner
      depends_on: [define_scope]
      context: [define_scope]
      task: |
        制定项目计划。

        项目范围：
        {{project_scope}}

        输出必须包含：阶段划分、里程碑、任务清单、依赖关系、建议负责人角色、时间安排。
      expected_output: 项目计划草案。
      output: project_plan
      context_policy: explicit
      context_max_chars: 22000
      timeout_seconds: 300
      retry_count: 1
    - id: review_risks
      name: 评审风险
      member: risk_reviewer
      depends_on: [define_scope, build_plan]
      context: [define_scope, build_plan]
      task: |
        评审项目计划风险。

        项目范围：
        {{project_scope}}

        项目计划：
        {{project_plan}}

        输出必须包含：风险清单、概率/影响、预警信号、缓解措施、需要升级的问题。
      expected_output: 项目风险评审。
      output: risk_register
      context_policy: explicit
      context_max_chars: 24000
      timeout_seconds: 240
      retry_count: 1
    - id: execution_setup
      name: 制定推进机制
      member: execution_advisor
      depends_on: [build_plan, review_risks]
      context: [build_plan, review_risks]
      task: |
        制定项目推进机制和下一步行动。

        项目计划：
        {{project_plan}}

        风险评审：
        {{risk_register}}

        输出必须包含：例会机制、同步节奏、看板建议、首周行动、决策点、沟通模板。
      expected_output: 推进机制和下一步行动建议。
      output: execution_setup
      context_policy: explicit
      context_max_chars: 22000
      timeout_seconds: 240
      retry_count: 1
    - id: final_plan
      name: 生成最终计划
      member: planner
      depends_on: [define_scope, build_plan, review_risks, execution_setup]
      context: [define_scope, build_plan, review_risks, execution_setup]
      task: |
        生成最终项目计划与风险评审文档。

        项目范围：
        {{project_scope}}

        项目计划：
        {{project_plan}}

        风险评审：
        {{risk_register}}

        推进机制：
        {{execution_setup}}

        文档必须包含：目标范围、里程碑、任务分解、风险清单、推进机制、首周行动、待确认事项。
      expected_output: 项目计划与风险评审最终文档。
      output: final_project_plan
      context_policy: explicit
      context_max_chars: 34000
      timeout_seconds: 300
      retry_count: 1
```

- [ ] **Step 2: Run targeted validation**

Run:

```bash
cd backend && ./.venv/bin/python - <<'PY'
from pathlib import Path
from app.expert.registry import ExpertTeamRegistry
from app.expert.validation import validate_expert_team_config
registry = ExpertTeamRegistry(presets_dir=Path("app/expert/presets"))
registry.scan()
team = registry.get_or_raise("project-plan-risk")
errors = validate_expert_team_config(team)
print(errors)
raise SystemExit(1 if errors else 0)
PY
```

Expected: prints `[]` and exits 0.

---

### Task 10: Update Bundle Guard for New Presets

**Files:**
- Modify: `scripts/verify-bundle.mjs`
- Modify: `scripts/release-workflow.test.mjs`

- [ ] **Step 1: Update `scripts/verify-bundle.mjs` required assets**

Find the existing required entries for `app/expert/presets` and `video_production.yaml`. Keep the directory entry, then add one file entry for each office preset:

```js
  {
    kind: "file",
    path: join(internal, "app", "expert", "presets", "data_analysis_report.yaml"),
    why: "data analysis report expert team preset",
  },
  {
    kind: "file",
    path: join(internal, "app", "expert", "presets", "meeting_notes_actions.yaml"),
    why: "meeting notes and actions expert team preset",
  },
  {
    kind: "file",
    path: join(internal, "app", "expert", "presets", "weekly_monthly_report.yaml"),
    why: "weekly and monthly report expert team preset",
  },
  {
    kind: "file",
    path: join(internal, "app", "expert", "presets", "document_review_polish.yaml"),
    why: "document review and polish expert team preset",
  },
  {
    kind: "file",
    path: join(internal, "app", "expert", "presets", "presentation_briefing.yaml"),
    why: "presentation briefing expert team preset",
  },
  {
    kind: "file",
    path: join(internal, "app", "expert", "presets", "research_competitive_analysis.yaml"),
    why: "research and competitive analysis expert team preset",
  },
  {
    kind: "file",
    path: join(internal, "app", "expert", "presets", "sales_proposal.yaml"),
    why: "sales proposal expert team preset",
  },
  {
    kind: "file",
    path: join(internal, "app", "expert", "presets", "project_plan_risk.yaml"),
    why: "project plan and risk expert team preset",
  },
```

- [ ] **Step 2: Update `scripts/release-workflow.test.mjs`**

Near the existing `workflow`, `pyinstallerSpec`, and `verifyBundleScript` constants, add:

```js
const expectedPresetFiles = [
  "video_production.yaml",
  "data_analysis_report.yaml",
  "meeting_notes_actions.yaml",
  "weekly_monthly_report.yaml",
  "document_review_polish.yaml",
  "presentation_briefing.yaml",
  "research_competitive_analysis.yaml",
  "sales_proposal.yaml",
  "project_plan_risk.yaml",
];
```

Replace the existing `backend bundle includes expert team presets` test body with:

```js
test("backend bundle includes expert team presets", () => {
  assert.match(pyinstallerSpec, /app['"], ['"]expert['"], ['"]presets/);
  assert.match(verifyBundleScript, /app", "expert", "presets"/);
  for (const filename of expectedPresetFiles) {
    assert.match(verifyBundleScript, new RegExp(filename.replace(".", "\\.")));
  }
});
```

- [ ] **Step 3: Run the Node release workflow test**

Run:

```bash
node --test scripts/release-workflow.test.mjs
```

Expected: PASS with all tests passing.

---

### Task 11: Run Full Preset Validation and Commit

**Files:**
- All files from Tasks 1-10.

- [ ] **Step 1: Run Python preset registry tests**

Run:

```bash
cd backend && ./.venv/bin/python -m pytest tests/test_expert/test_preset_registry.py -q
```

Expected: PASS. The output should show all tests in `test_preset_registry.py` passing.

- [ ] **Step 2: Run Node release workflow tests**

Run:

```bash
node --test scripts/release-workflow.test.mjs
```

Expected: PASS. The output should show all tests passing.

- [ ] **Step 3: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 4: Verify preset count and read-only status directly**

Run:

```bash
cd backend && ./.venv/bin/python - <<'PY'
from pathlib import Path
from app.expert.registry import ExpertTeamRegistry
expected = {
    "video-production",
    "data-analysis-report",
    "meeting-notes-actions",
    "weekly-monthly-report",
    "document-review-polish",
    "presentation-briefing",
    "research-competitive-analysis",
    "sales-proposal",
    "project-plan-risk",
}
registry = ExpertTeamRegistry(presets_dir=Path("app/expert/presets"))
registry.scan()
summaries = registry.list_teams()
preset_ids = {team.id for team in summaries if team.is_preset}
editable_presets = [team.id for team in summaries if team.is_preset and team.editable]
print(sorted(preset_ids))
print("editable_presets=", editable_presets)
raise SystemExit(0 if preset_ids == expected and not editable_presets else 1)
PY
```

Expected:

```text
['data-analysis-report', 'document-review-polish', 'meeting-notes-actions', 'presentation-briefing', 'project-plan-risk', 'research-competitive-analysis', 'sales-proposal', 'video-production', 'weekly-monthly-report']
editable_presets= []
```

- [ ] **Step 5: Review changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: modified tests and bundle guard, plus eight new YAML preset files.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/app/expert/presets/data_analysis_report.yaml \
  backend/app/expert/presets/meeting_notes_actions.yaml \
  backend/app/expert/presets/weekly_monthly_report.yaml \
  backend/app/expert/presets/document_review_polish.yaml \
  backend/app/expert/presets/presentation_briefing.yaml \
  backend/app/expert/presets/research_competitive_analysis.yaml \
  backend/app/expert/presets/sales_proposal.yaml \
  backend/app/expert/presets/project_plan_risk.yaml \
  backend/tests/test_expert/test_preset_registry.py \
  scripts/verify-bundle.mjs \
  scripts/release-workflow.test.mjs
git commit -m "feat: add office expert team presets"
```

Expected: commit succeeds.

---

## Self-Review

- Spec coverage: The plan creates exactly the requested eight built-in office expert teams and relies on existing preset registry behavior to make them read-only and not deletable.
- Preset reliability: Every team has explicit inputs, limited tools, validated output variables, final deliverable configuration, and targeted validation commands.
- Bundle reliability: The plan updates both `verify-bundle.mjs` and `release-workflow.test.mjs` so packaged releases must include the new preset files.
- Placeholder scan: No unfinished placeholder markers or unspecified implementation steps remain.
- Scope check: This is one focused subsystem: built-in expert-team YAML presets plus tests and packaging guards.
