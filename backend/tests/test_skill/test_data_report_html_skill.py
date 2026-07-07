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
    assert (SKILL_DIR / "knowledge" / "echarts-charting-rules.md").is_file()
    assert (SKILL_DIR / "templates" / "report-shell.html").is_file()


def test_credibility_rules_cover_caliber_and_asof():
    text = (SKILL_DIR / "knowledge" / "credibility-rules.md").read_text(encoding="utf-8")
    assert "自定义口径" in text
    assert "数据截至" in text
    # fact / inference / recommendation split
    assert "事实" in text and "推断" in text and "建议" in text


def test_report_shell_inlines_styles_and_only_echarts_cdn():
    html = (SKILL_DIR / "templates" / "report-shell.html").read_text(encoding="utf-8")
    # 内联样式
    assert "<style>" in html
    # 无 <link> 外部样式
    assert "<link" not in html
    # 唯一允许的外部资源是 echarts CDN;不得有其它外链
    external = [ln for ln in html.splitlines() if "http://" in ln or "https://" in ln]
    assert external, "应包含 echarts CDN 引用"
    for ln in external:
        assert "cdn.jsdelivr.net/npm/echarts" in ln, f"意外的外部资源: {ln}"


def test_echarts_rules_have_cdn_palette_and_light_theme():
    text = (SKILL_DIR / "knowledge" / "echarts-charting-rules.md").read_text(encoding="utf-8")
    assert "cdn.jsdelivr.net/npm/echarts" in text   # CDN 引用
    assert "#4f8ff7" in text                        # 8 色板首色，继承自 chart-renderer
    assert "backgroundColor" in text                # 浅色主题(透明底)标识
    assert "window.echarts" in text                 # 离线守卫
