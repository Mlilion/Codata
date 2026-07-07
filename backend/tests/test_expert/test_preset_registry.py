from pathlib import Path

import pytest

from app.config import Settings
from app.expert.registry import ExpertTeamRegistry
from app.expert.roles import ExpertRoleRegistry
from app.expert.validation import validate_expert_team_config
from app.main import _register_builtin_tools
from app.skill.registry import SkillRegistry
from app.tool.registry import ToolRegistry


EXPECTED_PRESET_IDS = {
    "data-analysis-report",
    "funnel-conversion",
    "ops-daily-diagnosis",
    "retention-cohort",
    "ab-experiment",
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


def test_builtin_preset_role_refs_exist(tmp_path: Path) -> None:
    registry = _registry(tmp_path)
    role_registry = ExpertRoleRegistry(
        dirs=[Path(__file__).resolve().parents[2] / "app" / "data" / "agency-agents-zh"],
    )
    role_registry.scan()

    missing = [
        (team.id, member.id, member.role_ref)
        for team in (registry.get_or_raise(summary.id) for summary in registry.list_teams())
        for member in team.members
        if member.role_ref and role_registry.get(member.role_ref) is None
    ]

    assert missing == []


def test_builtin_preset_tool_ids_are_registered(tmp_path: Path) -> None:
    registry = _registry(tmp_path)
    skill_registry = SkillRegistry(
        bundled_dir=Path(__file__).resolve().parents[2] / "app" / "data" / "skills",
    )
    skill_registry.scan()
    tool_registry = ToolRegistry()
    _register_builtin_tools(tool_registry, skill_registry=skill_registry, settings=Settings())
    tool_ids = {tool.id for tool in tool_registry.all_tools()}

    missing = []
    for summary in registry.list_teams():
        team = registry.get_or_raise(summary.id)
        declared_tools = set(team.finalization.tools)
        if team.finalization.deliverable:
            declared_tools.update(team.finalization.deliverable.tools)
        for member in team.members:
            declared_tools.update(member.tools)
        missing.extend((team.id, tool_id) for tool_id in sorted(declared_tools) if tool_id not in tool_ids)

    assert missing == []
