from __future__ import annotations

from pathlib import Path

from app.skill.registry import SkillRegistry

BUNDLED = Path(__file__).resolve().parents[2] / "app" / "data" / "skills"
SKILL_DIR = BUNDLED / "attribution-analysis"


def test_attribution_skill_loads_from_bundled_dir():
    registry = SkillRegistry(bundled_dir=BUNDLED)
    registry.scan()
    skill = registry.get("attribution-analysis")
    assert skill is not None
    assert "metric changed" in skill.description


def test_attribution_skill_preserves_analysis_freedom_and_causal_boundary():
    text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    assert "Do not force a fixed tool sequence" in text
    assert "Contribution is not causality" in text
    assert "build_report" in text


def test_attribution_skill_has_routed_references():
    for name in (
        "knowledge/attribution-methods.md",
        "knowledge/report-structure.md",
        "knowledge/credibility-rules.md",
    ):
        assert (SKILL_DIR / name).is_file()
