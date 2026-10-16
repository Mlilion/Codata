from pathlib import Path

from app.expert.roles import ExpertRoleRegistry


def _write_role(path: Path, *, name: str, description: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n\n角色提示词",
        encoding="utf-8",
    )


def test_prefers_zh_roles_and_skips_plain_markdown(tmp_path: Path) -> None:
    zh = tmp_path / "agency-agents-zh"
    en = tmp_path / "agency-agents"
    _write_role(zh / "engineering" / "frontend.md", name="前端开发者", description="中文角色")
    _write_role(en / "engineering" / "frontend.md", name="Frontend Developer", description="English role")
    (zh / "README.md").write_text("# 文档不是角色", encoding="utf-8")

    registry = ExpertRoleRegistry(dirs=[zh, en])
    registry.scan()

    roles = registry.list_roles()
    assert registry.active_language == "zh"
    assert registry.using_fallback is False
    assert len(roles) == 1
    assert roles[0].id == "engineering/frontend"
    assert roles[0].name == "前端开发者"
    assert roles[0].source == str(zh / "engineering" / "frontend.md")


def test_falls_back_to_en_when_zh_missing(tmp_path: Path) -> None:
    zh = tmp_path / "agency-agents-zh"
    en = tmp_path / "agency-agents"
    _write_role(en / "engineering" / "frontend.md", name="Frontend Developer", description="English role")

    registry = ExpertRoleRegistry(dirs=[zh, en])
    registry.scan()

    roles = registry.list_roles()
    assert registry.active_language == "en"
    assert registry.using_fallback is True
    assert str(zh.resolve()) in registry.missing_preferred_dirs
    assert roles[0].name == "Frontend Developer"


def test_default_dirs_have_no_personal_absolute_paths() -> None:
    dirs = ExpertRoleRegistry._default_dirs(project_dir=None)

    assert all("/Users/apple/code/agency-orchestrator" not in str(path) for path in dirs)
