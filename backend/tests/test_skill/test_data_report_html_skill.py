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
