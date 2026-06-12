from types import SimpleNamespace

import pytest

from app.expert.models import ExpertInteractionMode, ExpertOutputStyle, ExpertTeamConfig, ExpertTeamSummonRequest
from app.expert.runner import ExpertTeamRunner
from app.expert.workflow import render_template
from app.skill.model import SkillInfo
from app.streaming.manager import GenerationJob


def _runner(team: ExpertTeamConfig) -> ExpertTeamRunner:
    return ExpertTeamRunner(
        team=team,
        request=ExpertTeamSummonRequest(input="用户任务"),
        job=GenerationJob(stream_id="stream", session_id="session"),
        session_factory=None,  # type: ignore[arg-type]
        provider_registry=None,  # type: ignore[arg-type]
        tool_registry=None,  # type: ignore[arg-type]
    )


def test_auto_context_avoids_duplicate_dependency_output_when_template_references_it() -> None:
    team = ExpertTeamConfig(
        id="ctx",
        name="上下文测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[
            {"id": "first", "name": "一", "member": "m", "task": "一", "output": "first_output"},
            {
                "id": "second",
                "name": "二",
                "member": "m",
                "task": "处理：{{first_output}}",
                "depends_on": ["first"],
            },
        ],
    )
    runner = _runner(team)
    runner._prepare_context()
    runner._record_task_output(team.tasks[0], "上游完整输出", status="completed")

    message = runner._build_messages(team.tasks[1])[0]["content"]

    assert "处理：上游完整输出" in message
    assert "Previous expert outputs" not in message


def test_auto_context_uses_handoff_for_dependency_outputs() -> None:
    team = ExpertTeamConfig(
        id="ctx-handoff",
        name="交接上下文测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[
            {"id": "first", "name": "一", "member": "m", "task": "一", "output": "first_output"},
            {
                "id": "second",
                "name": "二",
                "member": "m",
                "task": "基于上一步继续",
                "depends_on": ["first"],
            },
        ],
    )
    runner = _runner(team)
    runner._prepare_context()
    long_output = "完整内容开始\n" + ("细节" * 3000) + "\n关键结论：保留这个交接重点\n下一步：继续执行"
    runner._record_task_output(team.tasks[0], long_output, status="completed")

    message = runner._build_messages(team.tasks[1])[0]["content"]

    assert "Previous expert outputs" in message
    assert "关键结论：保留这个交接重点" in message
    assert len(message) < len(long_output)


def test_expert_team_defaults_to_concise_visible_output() -> None:
    team = ExpertTeamConfig(
        id="concise-default",
        name="简洁输出默认值测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )

    assert team.expert_output_style == ExpertOutputStyle.CONCISE
    assert team.expert_visible_max_chars == 1800
    assert team.coordinator_visible_max_chars == 2400


def test_system_and_coordinator_prompts_include_concise_output_contract() -> None:
    team = ExpertTeamConfig(
        id="concise-prompt",
        name="简洁提示词测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)

    system_prompt = runner._build_system_prompt(team.members[0])
    coordinator_prompt = runner._build_coordinator_prompt()

    assert "Output style:" in system_prompt
    assert "交接摘要" in system_prompt
    assert "Final answer style:" in coordinator_prompt
    assert "instead of replaying each expert's full output" in coordinator_prompt


def test_visible_task_output_compacts_long_text_but_records_raw_output() -> None:
    team = ExpertTeamConfig(
        id="visible-summary",
        name="可见摘要测试",
        expert_visible_max_chars=800,
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    long_output = "完整正文\n" + ("细节" * 3000) + "\n关键结论：保留这个交接重点\n下一步：继续执行"

    visible = runner._visible_task_output(
        team.tasks[0],
        long_output,
        member=team.members[0],
        structured=None,
    )
    runner._record_task_output(team.tasks[0], long_output, status="completed")

    assert len(visible) <= team.expert_visible_max_chars
    assert "关键结论：保留这个交接重点" in visible
    assert runner.task_outputs["task"] == long_output
    assert runner.context["task"] == long_output


def test_full_expert_output_style_keeps_visible_output_uncompacted() -> None:
    team = ExpertTeamConfig(
        id="full-output",
        name="完整输出测试",
        expert_output_style="full",
        expert_visible_max_chars=500,
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    output = "完整正文\n" + ("细节" * 1000)

    visible = runner._visible_task_output(
        team.tasks[0],
        output,
        member=team.members[0],
        structured=None,
    )

    assert visible == output


@pytest.mark.asyncio
async def test_run_task_without_session_factory_streams_visible_output_and_keeps_raw_record() -> None:
    team = ExpertTeamConfig(
        id="memory-run",
        name="内存执行测试",
        expert_visible_max_chars=600,
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务", "tools": []}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    runner.provider_registry = SimpleNamespace(resolve_model=lambda *_args, **_kwargs: None)
    runner.tools = SimpleNamespace(
        build_agent=lambda **_kwargs: SimpleNamespace(permissions=SimpleNamespace(rules=[])),
        specs=lambda *_args, **_kwargs: [],
    )
    output = "完整正文\n" + ("细节" * 3000) + "\n关键结论：保留原始记录"

    async def fake_stream_once_with_retry(**_kwargs):
        return output, [], "stop"

    runner._stream_once_with_retry = fake_stream_once_with_retry  # type: ignore[method-assign]

    result = await runner._run_task_impl(1, team.tasks[0], team.members[0], message_id_override="message")

    visible_events = [event.data["text"] for event in runner.job.events if event.event == "text-delta"]
    assert result.text == output
    assert runner.task_outputs["task"] == output
    assert len(visible_events) == 1
    assert len(visible_events[0]) <= team.expert_visible_max_chars
    assert "关键结论：保留原始记录" in visible_events[0]


def test_attachments_template_renders_without_uploaded_files() -> None:
    team = ExpertTeamConfig(
        id="attachments",
        name="附件上下文测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[
            {
                "id": "task",
                "name": "任务",
                "member": "m",
                "task": "附件：\n{{attachments}}",
            }
        ],
    )
    runner = _runner(team)
    runner._prepare_context()

    message = runner._build_messages(team.tasks[0])[0]["content"]

    assert "附件：\nNo attachments provided." in message


def test_required_input_questions_preserve_select_options_and_normalize_values() -> None:
    team = ExpertTeamConfig(
        id="input-options",
        name="输入选项测试",
        inputs=[
            {
                "name": "media_preset",
                "description": "生图和视频模型方案。",
                "required": True,
                "options": [
                    {"label": "Gemini / Veo", "value": "gemini", "description": "通用电影感视频"},
                    {"label": "豆包 Seedream / Seedance", "value": "doubao", "description": "中文语义和低成本测试"},
                ],
            }
        ],
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "{{media_preset}}"}],
    )
    runner = _runner(team)
    runner._prepare_context()

    questions = runner._dedupe_questions(runner._required_input_questions())
    assert questions == [
        {
            "header": "生图和视频模型方案。",
            "question": "请补充「生图和视频模型方案。」。",
            "input_key": "media_preset",
            "options": [
                {"label": "Gemini / Veo", "description": "通用电影感视频"},
                {"label": "豆包 Seedream / Seedance", "description": "中文语义和低成本测试"},
            ],
            "multiSelect": False,
        }
    ]

    mapped = runner._map_answers_to_inputs({"请补充「生图和视频模型方案。」。": "豆包 Seedream / Seedance"})
    assert mapped == {"media_preset": "doubao"}


def test_required_option_input_timeout_uses_first_option_value() -> None:
    team = ExpertTeamConfig(
        id="input-timeout",
        name="输入超时测试",
        inputs=[
            {
                "name": "media_preset",
                "description": "生图和视频模型方案。",
                "required": True,
                "options": [
                    {"label": "Gemini / Veo", "value": "gemini"},
                    {"label": "豆包 Seedream / Seedance", "value": "doubao"},
                ],
            }
        ],
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "{{media_preset}}"}],
    )
    runner = _runner(team)
    runner._prepare_context()

    runner._fill_missing_required_inputs("fallback")

    assert runner.context["media_preset"] == "gemini"


def test_runtime_required_input_is_skipped_when_setting_exists() -> None:
    team = ExpertTeamConfig(
        id="runtime-input-configured",
        name="运行时输入测试",
        inputs=[
            {
                "name": "media_preset",
                "description": "生图和视频模型方案。",
                "required": False,
                "default": "",
                "required_when_setting_missing": "vimax_media_preset",
                "options": [
                    {"label": "Gemini / Veo", "value": "gemini"},
                    {"label": "豆包 Seedream / Seedance", "value": "doubao"},
                ],
            }
        ],
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "{{media_preset}}"}],
    )
    runner = ExpertTeamRunner(
        team=team,
        request=ExpertTeamSummonRequest(input="用户任务"),
        job=GenerationJob(stream_id="stream", session_id="session"),
        session_factory=None,  # type: ignore[arg-type]
        provider_registry=None,  # type: ignore[arg-type]
        tool_registry=None,  # type: ignore[arg-type]
        settings=SimpleNamespace(vimax_media_preset="gemini"),
    )
    runner._prepare_context()

    assert runner._required_input_questions(blocking=True) == []


def test_runtime_required_input_asks_when_setting_missing() -> None:
    team = ExpertTeamConfig(
        id="runtime-input-missing",
        name="运行时输入测试",
        inputs=[
            {
                "name": "media_preset",
                "description": "生图和视频模型方案。",
                "required": False,
                "default": "",
                "required_when_setting_missing": "vimax_media_preset",
                "options": [
                    {"label": "Gemini / Veo", "value": "gemini", "description": "通用电影感视频"},
                    {"label": "豆包 Seedream / Seedance", "value": "doubao", "description": "中文语义和低成本测试"},
                    {"label": "ViMax YAML 配置", "value": "config", "description": "使用 ViMax YAML"},
                ],
            }
        ],
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "{{media_preset}}"}],
    )
    runner = ExpertTeamRunner(
        team=team,
        request=ExpertTeamSummonRequest(input="用户任务"),
        job=GenerationJob(stream_id="stream", session_id="session"),
        session_factory=None,  # type: ignore[arg-type]
        provider_registry=None,  # type: ignore[arg-type]
        tool_registry=None,  # type: ignore[arg-type]
        settings=SimpleNamespace(vimax_media_preset=""),
    )
    runner._prepare_context()

    questions = runner._required_input_questions(blocking=True)
    assert len(questions) == 1
    assert questions[0]["input_key"] == "media_preset"
    assert questions[0]["blocking"] is True
    assert questions[0]["reason"] == "missing_required_input"
    assert [option["label"] for option in questions[0]["options"]] == [
        "Gemini / Veo",
        "豆包 Seedream / Seedance",
        "ViMax YAML 配置",
    ]
    assert runner._map_answers_to_inputs({"media_preset": "豆包 Seedream / Seedance"}, questions) == {
        "media_preset": "doubao"
    }


def test_preflight_decision_questions_are_blocking_when_llm_asks_user() -> None:
    team = ExpertTeamConfig(
        id="preflight-decision",
        name="前置决策测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    decision = runner._normalize_preflight_decision(
        {
            "decision": "ask_user",
            "reason": "missing_context",
            "confidence": 0.9,
            "questions": [
                {
                    "header": "交付物",
                    "question": "请确认最终交付物类型。",
                    "input_key": "deliverable_type",
                    "required": True,
                }
            ],
        }
    )

    questions = runner._questions_from_preflight_decision(decision)

    assert questions == [
        {
            "header": "交付物",
            "question": "请确认最终交付物类型。",
            "input_key": "deliverable_type",
            "blocking": True,
            "required": True,
            "reason": "missing_context",
            "severity": "blocking",
        }
    ]


def test_preflight_decision_missing_attachment_is_rechecked_by_backend() -> None:
    team = ExpertTeamConfig(
        id="preflight-attachment",
        name="附件前置测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    runner._prepare_context()

    questions = runner._deterministic_preflight_questions({"required_attachments": True})

    assert len(questions) == 1
    assert questions[0]["reason"] == "missing_attachment"
    assert questions[0]["blocking"] is True


def test_preflight_rechecks_missing_referenced_paths_from_llm(tmp_path) -> None:
    team = ExpertTeamConfig(
        id="preflight-path",
        name="路径前置测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = ExpertTeamRunner(
        team=team,
        request=ExpertTeamSummonRequest(input="处理资料", workspace=str(tmp_path)),
        job=GenerationJob(stream_id="stream", session_id="session"),
        session_factory=None,  # type: ignore[arg-type]
        provider_registry=None,  # type: ignore[arg-type]
        tool_registry=None,  # type: ignore[arg-type]
    )

    questions = runner._deterministic_preflight_questions({"referenced_paths": ["missing.csv"]})

    assert len(questions) == 1
    assert questions[0]["reason"] == "missing_referenced_file"
    assert "missing.csv" in questions[0]["question"]


def test_preflight_blocked_without_questions_gets_confirmation_fallback() -> None:
    team = ExpertTeamConfig(
        id="preflight-blocked",
        name="前置阻塞测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)

    questions = runner._questions_from_preflight_decision({"decision": "blocked", "reason": "permission"})

    assert len(questions) == 1
    assert questions[0]["input_key"] == "preflight_confirmation"
    assert questions[0]["blocking"] is True


@pytest.mark.asyncio
async def test_preflight_keeps_all_blocking_questions_even_above_nominal_limit(tmp_path) -> None:
    team = ExpertTeamConfig(
        id="preflight-combined",
        name="组合前置测试",
        max_clarifying_questions=1,
        inputs=[
            {
                "name": "media_preset",
                "description": "模型方案",
                "required": True,
                "options": [
                    {"label": "Gemini / Veo", "value": "gemini"},
                    {"label": "豆包 Seedream / Seedance", "value": "doubao"},
                ],
            }
        ],
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "{{media_preset}}"}],
    )
    runner = ExpertTeamRunner(
        team=team,
        request=ExpertTeamSummonRequest(input="处理资料", workspace=str(tmp_path)),
        job=GenerationJob(stream_id="stream", session_id="session"),
        session_factory=None,  # type: ignore[arg-type]
        provider_registry=None,  # type: ignore[arg-type]
        tool_registry=None,  # type: ignore[arg-type]
    )
    runner._prepare_context()
    decision = runner._normalize_preflight_decision(
        {
            "decision": "ask_user",
            "reason": "missing_context",
            "questions": [{"header": "目标", "question": "请确认最终目标。", "input_key": "goal"}],
            "required_attachments": True,
            "referenced_paths": ["missing.csv"],
        }
    )

    questions = await runner._preflight_questions(
        ExpertInteractionMode.AUTO,
        blocking_questions=runner._deterministic_preflight_questions(decision),
        decision=decision,
    )

    reasons = {question.get("reason") for question in questions}
    assert reasons == {"missing_attachment", "missing_referenced_file", "missing_required_input", "missing_context"}
    assert all(question.get("blocking") for question in questions)

    answers = runner._parse_preflight_answers({"media_preset": "豆包 Seedream / Seedance"}, questions)
    assert runner._map_answers_to_inputs(answers, questions) == {"media_preset": "doubao"}


@pytest.mark.asyncio
async def test_preflight_blocking_questions_fail_fast_when_not_interactive(monkeypatch: pytest.MonkeyPatch) -> None:
    team = ExpertTeamConfig(
        id="preflight-headless",
        name="非交互前置测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    runner._prepare_context()

    async def fake_decision():
        return {"required_attachments": True}

    runner._llm_preflight_decision = fake_decision  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="专家团开始前需要用户补充或确认关键信息"):
        await runner._run_preflight_interaction()


@pytest.mark.asyncio
async def test_stream_once_retries_after_transient_failure() -> None:
    team = ExpertTeamConfig(
        id="retry",
        name="重试测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[
            {
                "id": "task",
                "name": "任务",
                "member": "m",
                "task": "任务",
                "retry_count": 1,
                "timeout_seconds": 5,
            }
        ],
    )
    runner = _runner(team)
    calls = 0

    async def fake_stream_once(**_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("temporary 500")
        return "ok", [], "stop"

    runner._stream_once = fake_stream_once  # type: ignore[method-assign]
    runner._retry_delay = lambda attempt, error: 0  # type: ignore[method-assign]

    result = await runner._stream_once_with_retry(
        task=team.tasks[0],
        member=team.members[0],
        message_id="message",
        system="system",
        messages=[],
        tools=None,
    )

    assert result == ("ok", [], "stop")
    assert calls == 2


def test_accumulate_usage_isolated_by_contextvar() -> None:
    team = ExpertTeamConfig(
        id="usage",
        name="用量测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    usage = {"input": 0, "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0}
    from app.expert import runner as runner_module

    token = runner_module._ACTIVE_USAGE.set(usage)
    try:
        runner._accumulate_usage({"input": 11, "output": 3})
    finally:
        runner_module._ACTIVE_USAGE.reset(token)

    assert usage["input"] == 11
    assert usage["output"] == 3
    assert runner.total_tokens["input"] == 0


def test_cost_for_usage_uses_resolved_model_pricing() -> None:
    team = ExpertTeamConfig(
        id="cost",
        name="成本测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    runner.request.model = "priced-model"
    runner.provider_registry = SimpleNamespace(
        resolve_model=lambda model, provider_id=None: (
            object(),
            SimpleNamespace(pricing=SimpleNamespace(prompt=2.0, completion=10.0)),
        )
    )

    cost = runner._cost_for_usage(
        {"input": 1_000_000, "output": 500_000, "reasoning": 100_000, "cache_read": 0, "cache_write": 0},
        team.members[0],
    )

    assert cost == 8.0


@pytest.mark.asyncio
async def test_finalization_last_task_skips_coordinator(monkeypatch: pytest.MonkeyPatch) -> None:
    team = ExpertTeamConfig(
        id="finalize-last",
        name="最终交付测试",
        finalization={"mode": "last_task"},
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    runner._record_task_output(team.tasks[0], "最终产物", status="completed")

    called = {"coordinator": 0}

    async def fake_coordinator(*_args, **_kwargs):
        called["coordinator"] += 1

    runner._run_coordinator = fake_coordinator  # type: ignore[method-assign]

    await runner._run_finalization(2)

    assert called["coordinator"] == 0
    assert runner.task_outputs["task"] == "最终产物"


@pytest.mark.asyncio
async def test_deliverable_finalization_requires_real_output(monkeypatch: pytest.MonkeyPatch) -> None:
    team = ExpertTeamConfig(
        id="finalize-deliverable",
        name="最终产物测试",
        finalization={
            "mode": "deliverable",
            "deliverable": {
                "type": "markdown",
                "title": "最终报告",
                "required": True,
                "tools": ["write", "present_file"],
            },
        },
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    runner._record_task_output(team.tasks[0], "上游结果", status="completed")

    async def fake_run_task(*_args, **_kwargs):
        return SimpleNamespace(text="只返回文本", usage={"input": 1, "output": 1, "reasoning": 0, "cache_read": 0, "cache_write": 0}, cost=0.0, status="completed", rounds=1, truncated=False, structured=None)

    runner.task_runner.run_task = fake_run_task  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="Final deliverable was required"):
        await runner._run_finalization(2)


@pytest.mark.asyncio
async def test_deliverable_finalization_retries_until_tool_presents_file() -> None:
    team = ExpertTeamConfig(
        id="finalize-deliverable-retry",
        name="最终产物重试测试",
        finalization={
            "mode": "deliverable",
            "deliverable": {
                "type": "markdown",
                "title": "最终报告",
                "required": True,
                "tools": ["write", "present_file"],
            },
        },
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    runner._record_task_output(team.tasks[0], "上游结果", status="completed")
    calls = 0

    async def fake_run_task(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            runner._record_deliverable_output(
                "present_file",
                "Presented /tmp/final.md",
                {"file_path": "/tmp/final.md", "title": "最终报告"},
                args={"file_path": "/tmp/final.md"},
            )
        return SimpleNamespace(text="交付说明", usage={"input": 1, "output": 1, "reasoning": 0, "cache_read": 0, "cache_write": 0}, cost=0.0, status="completed", rounds=1, truncated=False, structured=None)

    runner.task_runner.run_task = fake_run_task  # type: ignore[method-assign]

    await runner._run_finalization(2)

    assert calls == 2
    assert runner._deliverable_outputs[-1]["path"] == "/tmp/final.md"


def test_deliverable_context_excludes_selected_source_from_handoff_context() -> None:
    team = ExpertTeamConfig(
        id="deliverable-dedupe",
        name="最终产物去重测试",
        finalization={
            "mode": "deliverable",
            "deliverable": {
                "type": "markdown",
                "source": "last_task",
                "tools": ["write", "present_file"],
            },
        },
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[
            {"id": "research", "name": "调研", "member": "m", "task": "调研"},
            {"id": "final", "name": "最终", "member": "m", "task": "最终", "depends_on": ["research"]},
        ],
    )
    runner = _runner(team)
    runner._record_task_output(team.tasks[0], "调研交接摘要", status="completed")
    runner._record_task_output(team.tasks[1], "最终完整内容", status="completed")
    deliverable = team.finalization.deliverable
    assert deliverable is not None

    message = runner._build_deliverable_messages(deliverable)[0]["content"]

    assert "Expert team handoff context" in message
    assert "调研交接摘要" in message
    assert message.count("最终完整内容") == 1
    assert "Preferred source material for final deliverable:\n最终完整内容" in message


@pytest.mark.asyncio
async def test_legacy_text_finalization_is_forced_to_deliverable_for_file_request() -> None:
    team = ExpertTeamConfig(
        id="legacy-deliverable",
        name="旧专家团",
        finalization={"mode": "last_task"},
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = ExpertTeamRunner(
        team=team,
        request=ExpertTeamSummonRequest(input="请交付一个最终报告文件"),
        job=GenerationJob(stream_id="stream", session_id="session"),
        session_factory=None,  # type: ignore[arg-type]
        provider_registry=None,  # type: ignore[arg-type]
        tool_registry=None,  # type: ignore[arg-type]
    )
    runner._record_task_output(team.tasks[0], "上游结果", status="completed")
    called = {"deliverable": 0, "last_task": 0}

    async def fake_deliverable(_step):
        called["deliverable"] += 1

    async def fake_last_task(_step):
        called["last_task"] += 1

    runner._run_deliverable_finalization = fake_deliverable  # type: ignore[method-assign]
    runner._persist_last_task_finalization = fake_last_task  # type: ignore[method-assign]

    await runner._run_finalization(2)

    assert called == {"deliverable": 1, "last_task": 0}


def test_video_deliverable_does_not_accept_markdown_file() -> None:
    team = ExpertTeamConfig(
        id="video-contract",
        name="视频产物契约",
        finalization={
            "mode": "deliverable",
            "deliverable": {"type": "video", "required": True},
        },
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    deliverable = team.finalization.deliverable
    assert deliverable is not None
    runner._record_deliverable_output(
        "present_file",
        "Presented /tmp/final.md",
        {"file_path": "/tmp/final.md", "title": "最终报告"},
        args={"file_path": "/tmp/final.md"},
    )

    assert runner._has_new_deliverable_output(deliverable, 0) is False


@pytest.mark.asyncio
async def test_deliverable_output_tracking_marks_presented_file() -> None:
    team = ExpertTeamConfig(
        id="track-deliverable",
        name="交付物追踪测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)
    runner._record_deliverable_output(
        "present_file",
        "Presented /tmp/final.md",
        {"file_path": "/tmp/final.md", "title": "最终产物"},
        title="最终产物",
        args={"file_path": "/tmp/final.md"},
    )

    assert runner._deliverable_outputs[-1]["kind"] == "file"


def test_structured_output_is_injected_into_context() -> None:
    team = ExpertTeamConfig(
        id="structured",
        name="结构化测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[
            {
                "id": "plan",
                "name": "计划",
                "member": "m",
                "task": "任务",
                "output": "plan_output",
                "output_schema": {
                    "type": "object",
                    "properties": {"summary": {"type": "string"}},
                    "required": ["summary"],
                },
            }
        ],
    )
    runner = _runner(team)
    runner._prepare_context()

    runner._record_task_output(team.tasks[0], "{}", status="completed", structured={"summary": "ok"})

    assert runner.context["plan"] == '{"summary":"ok"}'
    assert runner.context["plan_output"] == '{"summary":"ok"}'
    assert runner.task_statuses["plan"]["structured"] == {"summary": "ok"}


def test_structured_template_path_reads_nested_json() -> None:
    rendered = render_template("摘要：{{plan_output.summary}}", {"plan_output": '{"summary":"ok"}'})

    assert rendered == "摘要：ok"


def test_output_schema_rejects_additional_properties() -> None:
    team = ExpertTeamConfig(
        id="schema",
        name="Schema 测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务"}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = _runner(team)

    with pytest.raises(ValueError, match="Additional properties"):
        runner._validate_output_schema(
            {"summary": "ok", "extra": "no"},
            {
                "type": "object",
                "properties": {"summary": {"type": "string"}},
                "required": ["summary"],
                "additionalProperties": False,
            },
        )


def test_member_skills_are_preloaded_into_messages(tmp_path) -> None:
    skill_file = tmp_path / "demo" / "SKILL.md"
    skill_file.parent.mkdir()
    skill_file.write_text("---\nname: demo\ndescription: Demo skill\n---\nUse demo rules.", encoding="utf-8")
    registry = SimpleNamespace(
        get=lambda name: SkillInfo(
            name=name,
            description="Demo skill",
            location=str(skill_file),
            content="Use demo rules.",
        ),
        is_disabled=lambda _name: False,
    )
    team = ExpertTeamConfig(
        id="skills",
        name="技能测试",
        members=[{"id": "m", "name": "专家", "role": "专家", "goal": "完成任务", "skills": ["demo"]}],
        tasks=[{"id": "task", "name": "任务", "member": "m", "task": "任务"}],
    )
    runner = ExpertTeamRunner(
        team=team,
        request=ExpertTeamSummonRequest(input="用户任务"),
        job=GenerationJob(stream_id="stream", session_id="session"),
        session_factory=None,  # type: ignore[arg-type]
        provider_registry=None,  # type: ignore[arg-type]
        tool_registry=None,  # type: ignore[arg-type]
        skill_registry=registry,  # type: ignore[arg-type]
    )

    messages = runner._messages_with_auto_loaded_skills([{"role": "user", "content": "任务"}], team.members[0])

    assert messages[0]["role"] == "user"
    assert '<skill_content name="demo">' in messages[0]["content"]
    assert "Use demo rules." in messages[0]["content"]


def test_runtime_manager_id_is_valid_for_resume_requests() -> None:
    from app.expert.models import ExpertTeamResumeRequest

    request = ExpertTeamResumeRequest(from_task_id="__manager__")

    assert request.from_task_id == "__manager__"


def test_long_running_tool_task_gets_higher_round_budget() -> None:
    team = ExpertTeamConfig(
        id="video",
        name="视频测试",
        default_max_tool_rounds=6,
        members=[
            {
                "id": "producer",
                "name": "渲染执行",
                "role": "ViMax 渲染执行专家",
                "goal": "调用 ViMax 生成视频。",
                "tools": ["vimax_generate_video"],
            }
        ],
        tasks=[
            {
                "id": "render",
                "name": "视频渲染",
                "member": "producer",
                "task": "调用 vimax_generate_video 生成最终视频。",
            }
        ],
    )
    runner = _runner(team)

    assert runner._max_tool_rounds_for_task(team.tasks[0], team.members[0]) == 16


def test_hierarchical_dynamic_task_can_be_finalized_from_restored_state() -> None:
    team = ExpertTeamConfig(
        id="hier-dynamic-final",
        name="层级动态最终交付",
        process="hierarchical",
        manager={"submode": "autonomous"},
        members=[{"id": "writer", "name": "写作专家", "role": "写作", "goal": "写作"}],
        tasks=[],
    )
    runner = _runner(team)
    runner.task_outputs["delegation-3"] = "动态委派产物"
    runner.task_statuses["delegation-3"] = {
        "status": "completed",
        "member_id": "writer",
        "member_name": "写作专家",
        "member_role": "写作",
        "task_name": "委派任务 3",
        "task_description": "写作任务",
    }
    runner._mark_completed_output("delegation-3")

    task = runner._last_completed_task()

    assert task is not None
    assert task.id == "delegation-3"
    assert task.member == "writer"
