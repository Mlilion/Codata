import json
from types import SimpleNamespace
from pathlib import Path

import pytest

from app.expert.generator import _normalize_generated_team
import app.expert.generator as generator_module
from app.expert.creation_access import check_expert_team_creation_access
from app.expert.models import ExpertTeamConfig
from app.expert.registry import ExpertTeamRegistry
from app.schemas.agent import AgentInfo, PermissionRule, Ruleset
import app.tool.builtin.create_expert_teams as create_expert_teams_module
from app.tool.builtin.create_expert_teams import CreateExpertTeamsTool
from app.tool.context import ToolContext


def _agent() -> AgentInfo:
    return AgentInfo(
        name="creator",
        description="creator",
        mode="hidden",
        tools=["create_expert_teams"],
        permissions=Ruleset(rules=[PermissionRule(action="allow", permission="create_expert_teams")]),
    )


def _team_payload() -> dict:
    return {
        "id": "research-team",
        "name": "研究专家团",
        "description": "调研并输出建议。",
        "process": "workflow",
        "members": [
            {"id": "planner", "name": "规划专家", "role": "规划", "goal": "拆解任务。"},
            {"id": "researcher", "name": "研究专家", "role": "研究", "goal": "完成调研。"},
        ],
        "tasks": [
            {
                "id": "plan",
                "name": "规划",
                "member": "planner",
                "task": "分析 {{user_input}}",
                "output": "plan_result",
                "expected_output": "调研计划。",
            },
            {
                "id": "research",
                "name": "研究",
                "member": "researcher",
                "task": "根据 {{plan_result}} 输出调研结论。",
                "depends_on": ["plan"],
                "context": ["plan"],
                "output": "research_result",
                "expected_output": "调研报告。",
            },
        ],
    }


def _codata_settings() -> SimpleNamespace:
    return SimpleNamespace()


class _FakeProvider:
    id = "custom_example"


class _FakeProviderRegistry:
    def get_provider(self, provider_id: str):
        if provider_id == "custom_example":
            return _FakeProvider()
        return None

    def resolve_model(self, _model: str, provider_id: str | None = None):
        if provider_id not in {None, "custom_example"}:
            return None
        return _FakeProvider(), SimpleNamespace(id="gpt-5.5")


def test_normalize_generated_team_rewrites_member_and_task_refs() -> None:
    raw = {
        "name": "中文 ID 专家团",
        "members": [
            {"id": "规划专家", "name": "规划专家", "role": "规划", "goal": "规划"},
            {"id": "执行专家", "name": "执行专家", "role": "执行", "goal": "执行"},
        ],
        "tasks": [
            {"id": "任务规划", "name": "任务规划", "member": "规划专家", "task": "分析 {{user_input}}", "output": "plan_result"},
            {
                "id": "任务执行",
                "name": "任务执行",
                "member": "执行专家",
                "task": "执行 {{plan_result}}",
                "depends_on": ["任务规划"],
                "output": "final_result",
            },
        ],
    }

    normalized = _normalize_generated_team(raw, prompt="创建中文专家团", category="技术工程")

    assert normalized["members"][0]["id"] == "expert-1"
    assert normalized["members"][1]["id"] == "expert-2"
    assert normalized["tasks"][1]["member"] == "expert-2"
    assert normalized["tasks"][1]["depends_on"] == ["task-1"]


def test_normalize_generated_team_rewrites_output_template_refs() -> None:
    raw = {
        "name": "输出变量专家团",
        "members": [
            {"id": "planner", "name": "规划专家", "role": "规划", "goal": "规划"},
            {"id": "writer", "name": "写作专家", "role": "写作", "goal": "写作"},
        ],
        "tasks": [
            {"id": "plan", "name": "规划", "member": "planner", "task": "分析 {{user_input}}", "output": "规划结果"},
            {
                "id": "write",
                "name": "写作",
                "member": "writer",
                "task": "根据 {{规划结果}} 写作",
                "depends_on": ["plan"],
                "output": "final_result",
            },
        ],
    }

    normalized = _normalize_generated_team(raw, prompt="创建输出变量专家团", category="内容创作")

    assert normalized["tasks"][0]["output"] == "plan_result"
    assert "{{plan_result}}" in normalized["tasks"][1]["task"]


def test_normalize_generated_team_switches_complex_draft_to_hierarchical() -> None:
    raw = {
        "name": "复杂交付专家团",
        "process": "workflow",
        "description": "端到端完成复杂方案，需要统筹、动态委派、多轮审校和最终交付。",
        "members": [
            {"id": "manager", "name": "项目经理", "role": "统筹", "goal": "协调全流程"},
            {"id": "researcher", "name": "研究专家", "role": "研究", "goal": "完成调研"},
            {"id": "architect", "name": "架构专家", "role": "架构", "goal": "设计方案"},
            {"id": "reviewer", "name": "评审专家", "role": "评审", "goal": "审校质量"},
        ],
        "tasks": [
            {"id": "plan", "name": "规划", "member": "manager", "task": "自动拆解 {{user_input}}", "output": "plan_result"},
            {"id": "research", "name": "调研", "member": "researcher", "task": "调研 {{plan_result}}", "depends_on": ["plan"], "output": "research_result"},
            {"id": "design", "name": "设计", "member": "architect", "task": "设计 {{research_result}}", "depends_on": ["research"], "output": "design_result"},
            {"id": "review", "name": "审校", "member": "reviewer", "task": "评审 {{design_result}}", "depends_on": ["design"], "output": "review_result"},
            {"id": "revise", "name": "修订", "member": "architect", "task": "根据 {{review_result}} 修订", "depends_on": ["review"], "output": "final_result"},
            {"id": "deliver", "name": "交付", "member": "manager", "task": "整合 {{final_result}}", "depends_on": ["revise"], "output": "delivery_result"},
        ],
        "manager": {"member": "manager", "submode": "coordinated", "prompt": "统筹动态委派。"},
    }

    normalized = _normalize_generated_team(
        raw,
        prompt="创建一个复杂一站式交付专家团，需要 manager 统筹多阶段、多轮审校和动态委派。",
        category="技术工程",
    )

    assert normalized["process"] == "hierarchical"
    assert normalized["manager"]["member"] == "manager"
    assert normalized["metadata"]["process_decision"]["selected_process"] == "hierarchical"
    assert normalized["metadata"]["process_decision"]["complexity_score"] >= 70


def test_normalize_generated_team_keeps_simple_draft_non_hierarchical() -> None:
    raw = {
        "name": "简单写作专家团",
        "process": "workflow",
        "members": [
            {"id": "writer", "name": "写作专家", "role": "写作", "goal": "写作"},
            {"id": "editor", "name": "编辑专家", "role": "编辑", "goal": "编辑"},
        ],
        "tasks": [
            {"id": "draft", "name": "起草", "member": "writer", "task": "根据 {{user_input}} 起草", "output": "draft_result"},
            {"id": "edit", "name": "编辑", "member": "editor", "task": "编辑 {{draft_result}}", "depends_on": ["draft"], "output": "final_result"},
        ],
    }

    normalized = _normalize_generated_team(raw, prompt="创建一个简单文案写作专家团", category="内容创作")

    assert normalized["process"] == "workflow"
    assert normalized["manager"] is None
    assert normalized["metadata"]["process_decision"]["complexity_score"] < 70


def test_normalize_generated_team_defaults_finalization_to_deliverable() -> None:
    raw = {
        "name": "网页交付专家团",
        "members": [
            {"id": "designer", "name": "设计", "role": "设计", "goal": "设计"},
            {"id": "writer", "name": "写作", "role": "写作", "goal": "写作"},
        ],
        "tasks": [
            {"id": "design", "name": "设计", "member": "designer", "task": "设计 {{user_input}}", "output": "design_result"},
            {"id": "write", "name": "写作", "member": "writer", "task": "根据 {{design_result}} 写作网页内容", "depends_on": ["design"], "output": "final_result"},
        ],
    }

    normalized = _normalize_generated_team(raw, prompt="创建一个网页交付专家团", category="设计创意")

    assert normalized["finalization"]["mode"] == "deliverable"
    assert normalized["finalization"]["deliverable"]["type"] in {"html", "markdown"}
    assert normalized["finalization"]["deliverable"]["required"] is True


def test_expert_team_creation_access_allows_selected_provider() -> None:
    access = check_expert_team_creation_access(
        settings=_codata_settings(),
        provider_registry=_FakeProviderRegistry(),
        provider_id="custom_example",
        model="gpt-5.5",
    )

    assert access.allowed is True
    assert access.provider_id == "custom_example"
    assert access.detail["provider_id"] == "custom_example"


def test_expert_team_creation_access_rejects_provider_without_registry() -> None:
    access = check_expert_team_creation_access(
        settings=_codata_settings(),
        provider_registry=None,
        provider_id="not-a-real-provider",
        model="gpt-5.5",
    )

    assert access.allowed is False
    assert access.provider_id == ""


def test_expert_team_creation_access_rejects_unknown_provider() -> None:
    class FakeProviderRegistry:
        def get_provider(self, provider_id: str):
            return None

    access = check_expert_team_creation_access(
        settings=_codata_settings(),
        provider_registry=FakeProviderRegistry(),
        provider_id="not-a-real-provider",
        model=None,
    )

    assert access.allowed is False
    assert access.provider_id == ""


def test_expert_team_creation_access_requires_provider() -> None:
    access = check_expert_team_creation_access(
        settings=_codata_settings(),
        provider_id=None,
        model=None,
    )

    assert access.allowed is False
    assert access.detail["code"] == "expert_team_creation_requires_provider"
    assert access.detail["redirect"] == "/settings?tab=providers"


@pytest.mark.asyncio
async def test_generate_returns_draft_with_semantic_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeProvider:
        id = "fake-provider"

        async def stream_chat(self, *_args, **_kwargs):
            payload = {
                "team": {
                    "id": "bad-team",
                    "name": "坏草稿",
                    "members": [
                        {"id": "writer", "name": "写作专家", "role": "写作", "goal": "写作"},
                    ],
                    "tasks": [
                        {
                            "id": "write",
                            "name": "写作",
                            "member": "writer",
                            "task": "使用 {{missing_result}} 写作",
                            "output": "final_result",
                        }
                    ],
                },
                "explanation": "草稿说明",
            }
            yield SimpleNamespace(type="text-delta", data={"text": json.dumps(payload, ensure_ascii=False)})

    class FakeProviderRegistry:
        def all_models(self):
            return []

        async def refresh_models(self):
            return {}

        def resolve_model(self, _model, _provider_id=None):
            return (
                FakeProvider(),
                SimpleNamespace(
                    id="fake-model",
                    capabilities=SimpleNamespace(json_output=True, max_output=4096),
                    pricing=SimpleNamespace(prompt=0, completion=0),
                ),
            )

    role_registry = SimpleNamespace(list_roles=lambda: [])

    result = await generator_module.generate_expert_team_config(
        prompt="创建一个写作专家团",
        provider_registry=FakeProviderRegistry(),
        role_registry=role_registry,
        model="fake-model",
        provider_id="fake-provider",
    )

    assert result["team"].id == "bad-team"
    assert result["validation_errors"]
    assert any("unknown template variable" in error for error in result["validation_errors"])


@pytest.mark.asyncio
async def test_create_expert_teams_tool_validates_and_saves_team(tmp_path: Path) -> None:
    registry = ExpertTeamRegistry(presets_dir=tmp_path / "presets", user_dir=tmp_path / "user-teams")
    registry.scan()

    tool = CreateExpertTeamsTool()
    ctx = ToolContext(
        session_id="s1",
        message_id="m1",
        agent=_agent(),
        call_id="c1",
    )
    ctx._app_state = {  # type: ignore[attr-defined]
        "expert_team_registry": registry,
        "provider_registry": _FakeProviderRegistry(),
        "settings": _codata_settings(),
    }
    ctx._provider_id = "custom_example"  # type: ignore[attr-defined]

    result = await tool(
        {
            "team": _team_payload(),
            "save": True,
        },
        ctx,
    )

    assert result.success, result.error
    data = json.loads(result.output)
    assert data["saved"] is True
    assert data["team_id"] == "research-team"
    assert registry.get("research-team") is not None
    assert (tmp_path / "user-teams" / "research-team.yaml").exists()


@pytest.mark.asyncio
async def test_create_expert_teams_tool_saves_with_selected_provider(tmp_path: Path) -> None:
    registry = ExpertTeamRegistry(presets_dir=tmp_path / "presets", user_dir=tmp_path / "user-teams")
    registry.scan()

    tool = CreateExpertTeamsTool()
    ctx = ToolContext(
        session_id="s1",
        message_id="m1",
        agent=_agent(),
        call_id="c1",
    )
    ctx._app_state = {  # type: ignore[attr-defined]
        "expert_team_registry": registry,
        "provider_registry": _FakeProviderRegistry(),
        "settings": _codata_settings(),
    }
    ctx._model_id = "gpt-5.5"  # type: ignore[attr-defined]
    ctx._provider_id = "custom_example"  # type: ignore[attr-defined]

    result = await tool({"team": _team_payload(), "save": True}, ctx)

    assert result.success, result.error
    data = json.loads(result.output)
    assert data["saved"] is True
    assert registry.get("research-team") is not None


@pytest.mark.asyncio
async def test_create_expert_teams_tool_rejects_invalid_team(tmp_path: Path) -> None:
    registry = ExpertTeamRegistry(presets_dir=tmp_path / "presets", user_dir=tmp_path / "user-teams")
    registry.scan()
    payload = _team_payload()
    payload["tasks"][1]["depends_on"] = ["missing"]

    tool = CreateExpertTeamsTool()
    ctx = ToolContext(
        session_id="s1",
        message_id="m1",
        agent=_agent(),
        call_id="c1",
    )
    ctx._app_state = {  # type: ignore[attr-defined]
        "expert_team_registry": registry,
        "provider_registry": _FakeProviderRegistry(),
        "settings": _codata_settings(),
    }
    ctx._provider_id = "custom_example"  # type: ignore[attr-defined]

    result = await tool({"team": payload, "save": True}, ctx)

    assert not result.success
    assert "validation failed" in (result.error or "")


@pytest.mark.asyncio
async def test_create_expert_teams_tool_uses_context_provider_id(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registry = ExpertTeamRegistry(presets_dir=tmp_path / "presets", user_dir=tmp_path / "user-teams")
    registry.scan()
    seen: dict[str, str | None] = {}

    async def fake_generate_expert_team_config(**kwargs):
        seen["model"] = kwargs.get("model")
        seen["provider_id"] = kwargs.get("provider_id")
        return {
            "team": ExpertTeamConfig(**_team_payload()),
            "validation_errors": [],
            "explanation": "",
            "role_choices": [],
            "warnings": [],
            "cost_level": "low",
        }

    monkeypatch.setattr(
        create_expert_teams_module,
        "generate_expert_team_config",
        fake_generate_expert_team_config,
    )

    tool = CreateExpertTeamsTool()
    ctx = ToolContext(
        session_id="s1",
        message_id="m1",
        agent=_agent(),
        call_id="c1",
    )
    ctx._app_state = {  # type: ignore[attr-defined]
        "expert_team_registry": registry,
        "expert_role_registry": object(),
        "provider_registry": _FakeProviderRegistry(),
        "settings": _codata_settings(),
    }
    ctx._model_id = "gpt-5.5"  # type: ignore[attr-defined]
    ctx._provider_id = "custom_example"  # type: ignore[attr-defined]

    result = await tool({"prompt": "创建一个研究专家团"}, ctx)

    assert result.success, result.error
    assert seen == {"model": "gpt-5.5", "provider_id": "custom_example"}


@pytest.mark.asyncio
async def test_create_expert_teams_tool_returns_invalid_draft_without_saving(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registry = ExpertTeamRegistry(presets_dir=tmp_path / "presets", user_dir=tmp_path / "user-teams")
    registry.scan()
    draft = ExpertTeamConfig(**_team_payload())

    async def fake_generate_expert_team_config(**_kwargs):
        return {
            "team": draft,
            "validation_errors": ["Task 'x' references unknown template variable {{missing}}"],
            "explanation": "可修复草稿",
            "role_choices": [],
            "warnings": [],
            "cost_level": "medium",
        }

    monkeypatch.setattr(
        create_expert_teams_module,
        "generate_expert_team_config",
        fake_generate_expert_team_config,
    )

    tool = CreateExpertTeamsTool()
    ctx = ToolContext(
        session_id="s1",
        message_id="m1",
        agent=_agent(),
        call_id="c1",
    )
    ctx._app_state = {  # type: ignore[attr-defined]
        "expert_team_registry": registry,
        "expert_role_registry": object(),
        "provider_registry": _FakeProviderRegistry(),
        "settings": _codata_settings(),
    }
    ctx._model_id = "gpt-5.5"  # type: ignore[attr-defined]
    ctx._provider_id = "custom_example"  # type: ignore[attr-defined]

    result = await tool({"prompt": "创建一个有问题的专家团", "save": False}, ctx)

    assert result.success, result.error
    data = json.loads(result.output)
    assert data["team_id"] == draft.id
    assert data["validation_errors"]
    assert data["saved"] is False
    assert registry.get(draft.id) is None
