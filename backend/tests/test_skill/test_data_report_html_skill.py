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
