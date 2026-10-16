"""Tests for app.tool.builtin.chart_spec — validate + ship a chart spec."""

from __future__ import annotations

import pytest

from app.schemas.agent import AgentInfo
from app.tool.builtin.chart_spec import MAX_ROWS, ChartSpecTool
from app.tool.context import ToolContext


def _make_ctx() -> ToolContext:
    return ToolContext(
        session_id="test-session",
        message_id="test-msg",
        agent=AgentInfo(name="test", description="", mode="primary"),
        call_id="test-call",
    )


@pytest.fixture
def tool() -> ChartSpecTool:
    return ChartSpecTool()


class TestChartSpecTool:
    @pytest.mark.asyncio
    async def test_happy_path_line(self, tool: ChartSpecTool):
        result = await tool.execute(
            {
                "chart_type": "line",
                "columns": ["day", "dau"],
                "rows": [["2026-01-01", 100], ["2026-01-02", 120]],
                "x": "day",
                "y": ["dau"],
                "title": "DAU trend",
            },
            _make_ctx(),
        )
        assert result.success
        md = result.metadata
        assert md["codata_kind"] == "chart"
        assert md["chart_spec"]["chartType"] == "line"
        assert md["chart_spec"]["x"] == {"field": "day"}
        assert md["chart_spec"]["y"] == [{"field": "dau"}]
        assert md["chart_spec"]["title"] == "DAU trend"
        assert md["columns"] == [{"name": "day"}, {"name": "dau"}]
        assert md["row_count"] == 2
        assert md["truncated"] is False

    @pytest.mark.asyncio
    async def test_y_accepts_scalar_string(self, tool: ChartSpecTool):
        result = await tool.execute(
            {
                "chart_type": "bar",
                "columns": ["cat", "val"],
                "rows": [["a", 1]],
                "x": "cat",
                "y": "val",  # scalar, not list
            },
            _make_ctx(),
        )
        assert result.success
        assert result.metadata["chart_spec"]["y"] == [{"field": "val"}]

    @pytest.mark.asyncio
    async def test_series_included_when_valid(self, tool: ChartSpecTool):
        result = await tool.execute(
            {
                "chart_type": "grouped_bar",
                "columns": ["day", "dau", "platform"],
                "rows": [["d1", 1, "ios"]],
                "x": "day",
                "y": ["dau"],
                "series": "platform",
            },
            _make_ctx(),
        )
        assert result.success
        assert result.metadata["chart_spec"]["series"] == "platform"

    @pytest.mark.asyncio
    async def test_invalid_chart_type(self, tool: ChartSpecTool):
        result = await tool.execute(
            {"chart_type": "donut", "columns": ["a"], "rows": [], "x": "a", "y": ["a"]},
            _make_ctx(),
        )
        assert not result.success
        assert "chart_type" in (result.error or "")

    @pytest.mark.asyncio
    async def test_empty_columns(self, tool: ChartSpecTool):
        result = await tool.execute(
            {"chart_type": "bar", "columns": [], "rows": [], "x": "a", "y": ["a"]},
            _make_ctx(),
        )
        assert not result.success
        assert "columns" in (result.error or "")

    @pytest.mark.asyncio
    async def test_x_not_in_columns(self, tool: ChartSpecTool):
        result = await tool.execute(
            {"chart_type": "bar", "columns": ["a", "b"], "rows": [], "x": "z", "y": ["a"]},
            _make_ctx(),
        )
        assert not result.success
        assert "x field" in (result.error or "")

    @pytest.mark.asyncio
    async def test_y_missing_column(self, tool: ChartSpecTool):
        result = await tool.execute(
            {"chart_type": "bar", "columns": ["a", "b"], "rows": [], "x": "a", "y": ["z"]},
            _make_ctx(),
        )
        assert not result.success
        assert "y field" in (result.error or "")

    @pytest.mark.asyncio
    async def test_empty_y(self, tool: ChartSpecTool):
        result = await tool.execute(
            {"chart_type": "bar", "columns": ["a"], "rows": [], "x": "a", "y": []},
            _make_ctx(),
        )
        assert not result.success
        assert "y" in (result.error or "")

    @pytest.mark.asyncio
    async def test_series_not_in_columns(self, tool: ChartSpecTool):
        result = await tool.execute(
            {
                "chart_type": "bar",
                "columns": ["a", "b"],
                "rows": [],
                "x": "a",
                "y": ["b"],
                "series": "z",
            },
            _make_ctx(),
        )
        assert not result.success
        assert "series field" in (result.error or "")

    @pytest.mark.asyncio
    async def test_rows_capped_and_truncated_flag(self, tool: ChartSpecTool):
        rows = [["d", i] for i in range(MAX_ROWS + 25)]
        result = await tool.execute(
            {"chart_type": "line", "columns": ["k", "v"], "rows": rows, "x": "k", "y": ["v"]},
            _make_ctx(),
        )
        assert result.success
        assert len(result.metadata["rows"]) == MAX_ROWS
        assert result.metadata["row_count"] == MAX_ROWS + 25
        assert result.metadata["truncated"] is True
