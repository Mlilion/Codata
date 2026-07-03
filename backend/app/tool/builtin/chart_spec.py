"""Chart spec tool — turn a query result into a chart the frontend can render.

The model calls this after obtaining a tabular result (e.g. from datasage
execute_sql) when the data is worth visualising. Chart-type selection and
field mapping are semantic judgements the model makes; this tool only
validates the spec and ships it (together with the data) to the frontend via
``metadata`` under ``codata_kind: "chart"``.
"""

from __future__ import annotations

from typing import Any

from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext

CHART_TYPES = (
    "bar",
    "grouped_bar",
    "stacked_bar",
    "line",
    "multi_line",
    "pie",
    "area",
)

MAX_ROWS = 500


class ChartSpecTool(ToolDefinition):

    @property
    def id(self) -> str:
        return "chart_spec"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return (
            "Render a chart from a tabular query result in the user's data panel. "
            "Call this after a SQL query (e.g. execute_sql) returns rows that are "
            "worth visualising. You choose the chart type and which columns map to "
            "the axes. Chart types: bar, grouped_bar, stacked_bar, line, multi_line, "
            "pie, area. Pass the same columns/rows you got from the query."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "chart_type": {
                    "type": "string",
                    "enum": list(CHART_TYPES),
                    "description": "Chart type. Use line/multi_line for time series, "
                    "bar/grouped_bar/stacked_bar for categorical comparison, pie for "
                    "part-of-whole, area for cumulative trends.",
                },
                "columns": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Column names, in the order they appear in rows.",
                },
                "rows": {
                    "type": "array",
                    "items": {"type": "array"},
                    "description": "Result rows (array of arrays), matching columns order.",
                },
                "x": {
                    "type": "string",
                    "description": "Column name for the X axis (or the category/label field for pie).",
                },
                "y": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "One or more column names for the Y axis (measures). "
                    "For pie, the single value field.",
                },
                "series": {
                    "type": "string",
                    "description": "Optional column name to split into series/groups.",
                },
                "title": {"type": "string", "description": "Chart title."},
            },
            "required": ["chart_type", "columns", "rows", "x", "y"],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        chart_type = args.get("chart_type")
        if chart_type not in CHART_TYPES:
            return ToolResult(
                error=f"Invalid chart_type '{chart_type}'. Must be one of: {', '.join(CHART_TYPES)}"
            )

        columns = args.get("columns")
        rows = args.get("rows")
        if not isinstance(columns, list) or not columns:
            return ToolResult(error="'columns' must be a non-empty array of column names.")
        if not isinstance(rows, list):
            return ToolResult(error="'rows' must be an array of row arrays.")

        col_names = [str(c) for c in columns]
        col_set = set(col_names)

        x = str(args.get("x", ""))
        if x not in col_set:
            return ToolResult(error=f"x field '{x}' is not in columns {col_names}.")

        y_raw = args.get("y") or []
        if isinstance(y_raw, str):
            y_raw = [y_raw]
        y_fields = [str(f) for f in y_raw]
        missing = [f for f in y_fields if f not in col_set]
        if not y_fields:
            return ToolResult(error="'y' must name at least one measure column.")
        if missing:
            return ToolResult(error=f"y field(s) {missing} not in columns {col_names}.")

        series = args.get("series")
        if series is not None:
            series = str(series)
            if series not in col_set:
                return ToolResult(error=f"series field '{series}' is not in columns {col_names}.")

        title = str(args.get("title") or "")
        row_count = len(rows)
        capped_rows = rows[:MAX_ROWS]

        chart_spec = {
            "chartType": chart_type,
            "x": {"field": x},
            "y": [{"field": f} for f in y_fields],
            "title": title or None,
        }
        if series:
            chart_spec["series"] = series

        return ToolResult(
            output=f"Chart ready: {chart_type} ({title or x})",
            title=title or "Chart",
            metadata={
                "codata_kind": "chart",
                "chart_spec": chart_spec,
                "columns": [{"name": c} for c in col_names],
                "rows": capped_rows,
                "row_count": row_count,
                "truncated": row_count > MAX_ROWS,
            },
        )
