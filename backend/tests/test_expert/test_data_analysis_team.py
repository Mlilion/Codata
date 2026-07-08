"""Tests for the specialized data-analysis expert team + custom-team tool gating."""

from __future__ import annotations

from pathlib import Path

from app.expert.generator import _safe_tools
from app.expert.registry import ExpertTeamRegistry
from app.expert.roles import ExpertRoleRegistry

PRESETS_DIR = Path(__file__).resolve().parents[2] / "app" / "expert" / "presets"


class TestGeneratorToolGating:
    def test_run_query_and_chart_spec_allowed(self):
        # Custom (LLM-generated) analysis teams must be able to get these.
        out = _safe_tools(["run_query", "chart_spec", "search", "tool_search"])
        assert "run_query" in out
        assert "chart_spec" in out

    def test_removed_media_tools_stripped(self):
        out = _safe_tools(["vimax_generate_video", "baoyu_image_generate", "read"])
        assert "vimax_generate_video" not in out
        assert "baoyu_image_generate" not in out
        assert "read" in out


class TestDataAnalysisPreset:
    def test_preset_specialized_for_datasage(self):
        reg = ExpertTeamRegistry(presets_dir=PRESETS_DIR)
        reg.scan()
        team = reg.get("data-analysis-report")
        assert team is not None
        # Category is now a scenario label (综合分析); the "数据分析" tag is what
        # marks it a data team (matches runner._is_data_analysis_team).
        assert team.category == "综合分析"
        assert "数据分析" in team.tags
        # Members query via run_query (not code_execute on files).
        all_tools = {t for m in team.members for t in m.tools}
        assert "run_query" in all_tools
        assert "chart_spec" in all_tools
        assert "code_execute" not in all_tools
        # role_refs point at the new data specialists.
        refs = {m.role_ref for m in team.members}
        assert "data/sql-query-expert" in refs

    def test_data_role_files_resolve(self):
        rr = ExpertRoleRegistry()
        rr.scan()
        for ref in (
            "data/sql-query-expert",
            "data/metric-caliber-expert",
            "data/attribution-analyst",
            "data/visualization-expert",
        ):
            assert rr.get(ref) is not None, ref


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


class TestAnalysisMemoryInExpert:
    def test_data_team_flagged(self):
        reg = ExpertTeamRegistry(presets_dir=PRESETS_DIR)
        reg.scan()
        team = reg.get("data-analysis-report")

        # Build a minimal runner-like check of the category heuristic without a
        # full run: replicate the flag logic the runner uses.
        category = (team.category or "").strip()
        tags = {str(t).strip().lower() for t in (team.tags or [])}
        is_data = category == "数据分析" or "数据分析" in tags or "data-analysis" in tags
        assert is_data is True
