"""Tests for the build_report tool."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.schemas.agent import AgentInfo
from app.tool.builtin.build_report import BuildReportTool
from app.tool.context import ToolContext


def _ctx(workspace: str | None = None) -> ToolContext:
    return ToolContext(
        session_id="s", message_id="m",
        agent=AgentInfo(name="data", description="", mode="primary"),
        call_id="c", workspace=workspace,
    )


@pytest.mark.asyncio
class TestBuildReport:
    async def test_renders_html_artifact_metadata(self, tmp_path):
        r = await BuildReportTool().execute(
            {
                "title": "测试报告",
                "identifier": "t-report",
                "summary": ["要点1"],
                "charts": [{"type": "pie", "series": [{"name": "A", "value": 1}]}],
            },
            _ctx(workspace=str(tmp_path)),
        )
        assert r.success
        assert r.metadata["command"] == "create"
        assert r.metadata["type"] == "html"
        assert r.metadata["identifier"] == "t-report"
        assert r.metadata["title"] == "测试报告"
        assert "echarts" in r.metadata["content"]
        assert "<!DOCTYPE" in r.metadata["content"]

    async def test_writes_file_to_workspace(self, tmp_path):
        r = await BuildReportTool().execute(
            {"title": "落盘报告", "identifier": "saved-report", "summary": ["x"]},
            _ctx(workspace=str(tmp_path)),
        )
        assert r.success
        fp = r.metadata["file_path"]
        assert fp is not None
        p = Path(fp)
        # saved under {workspace}/codata_written/<identifier>.html
        assert p.parent == tmp_path / "codata_written"
        assert p.name == "saved-report.html"
        assert p.is_file()
        assert "<!DOCTYPE" in p.read_text(encoding="utf-8")

    async def test_requires_title_and_identifier(self):
        r = await BuildReportTool().execute({"title": "x"}, _ctx())
        assert not r.success
        assert "identifier" in (r.error or "")

    async def test_no_charts_still_renders(self, tmp_path):
        r = await BuildReportTool().execute(
            {"title": "纯文字", "identifier": "txt", "summary": ["无图"]},
            _ctx(workspace=str(tmp_path)),
        )
        assert r.success
        assert "echarts" not in r.metadata["content"]
        assert "执行摘要" in r.metadata["content"]
