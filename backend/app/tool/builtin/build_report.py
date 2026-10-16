"""build_report — assemble a data-analysis report from structured data.

The agent passes a structured report spec (title, KPIs, charts, insights,
caliber, ...) — NOT a big HTML string. The server renders it into a
self-contained HTML report via app.report.renderer and returns it as an
html artifact (same metadata shape the `artifact` tool emits), so the frontend
renders it in the preview panel with no extra wiring and the read-only data
agent doesn't need file-write permission.

Why structured-in / HTML-out: emitting a full HTML report as one tool argument
was overflowing the model's tool-call output and getting truncated mid-JSON.
Structured data is compact and reliable; assembly + palette + credibility
scaffolding are guaranteed correct server-side.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from app.report.renderer import render_report
from app.report.attribution import compile_attribution_spec
from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext

log = logging.getLogger(__name__)


def _report_output_dir(workspace: str | None) -> Path:
    """Where report .html files are written.

    - workspace set → {workspace}/codata_written/
    - workspace unset → ~/.codata/reports/
    The dir is created if missing.
    """
    if workspace:
        out = Path(workspace).resolve() / "codata_written"
    else:
        out = Path.home() / ".codata" / "reports"
    out.mkdir(parents=True, exist_ok=True)
    return out


def _safe_filename(identifier: str) -> str:
    slug = re.sub(r"[^\w.-]+", "-", identifier).strip("-") or "report"
    return f"{slug}.html"


class BuildReportTool(ToolDefinition):

    @property
    def id(self) -> str:
        return "build_report"

    @property
    def description(self) -> str:
        return (
            "Assemble a data-analysis report from STRUCTURED data (not HTML). "
            "Pass the analysis as a spec — title, summary points, KPI cards, charts "
            "(echarts, data inline), a detail table, insights tagged fact/inference/"
            "recommendation, caliber declarations, and caveats — and the server renders "
            "a self-contained interactive HTML report shown in the preview panel. "
            "Use this instead of writing HTML by hand. Provide numbers only from real "
            "query results; declare each core metric's caliber."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Report title."},
                "identifier": {
                    "type": "string",
                    "description": "Stable kebab-case id for the report artifact (e.g. 'gmv-30d-report').",
                },
                "subtitle": {"type": "string", "description": "One-line analysis subject (optional)."},
                "report_type": {
                    "type": "string",
                    "enum": ["general", "attribution"],
                    "description": "Optional report specialization. Use attribution for driver analysis.",
                },
                "analysis_type": {
                    "type": "string",
                    "description": "Attribution method, e.g. change_attribution, anomaly_attribution, metric_tree.",
                },
                "meta": {
                    "type": "object",
                    "description": "Header meta.",
                    "properties": {
                        "data_as_of": {"type": "string", "description": "Data as-of time, e.g. 2026-07-06."},
                        "generated_at": {"type": "string"},
                        "source": {"type": "string", "description": "Source table/system."},
                    },
                },
                "summary": {
                    "type": "array", "items": {"type": "string"},
                    "description": "Executive summary: 1 conclusion + 2-3 key findings.",
                },
                "kpis": {
                    "type": "array",
                    "description": "Core metric cards.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "value": {"type": "string"},
                            "delta_pct": {"type": "number", "description": "Signed % change vs comparison period."},
                            "delta_dir": {"type": "string", "enum": ["up", "down", "flat"]},
                            "delta_label": {"type": "string", "description": "Override delta text (optional)."},
                        },
                        "required": ["name", "value"],
                    },
                },
                "attribution": {
                    "type": "object",
                    "description": "Attribution overview for baseline/comparison analyses.",
                    "properties": {
                        "target_metric": {"type": "string"},
                        "baseline_value": {"type": "string"},
                        "current_value": {"type": "string"},
                        "delta_value": {"type": "string"},
                        "delta_pct": {"type": "number"},
                        "explained_pct": {"type": "number"},
                        "baseline_raw": {"type": "number"},
                        "current_raw": {"type": "number"},
                        "delta_raw": {"type": "number"},
                        "method": {"type": "string"},
                        "causal_claim": {"type": "boolean"},
                    },
                },
                "drivers": {
                    "type": "array",
                    "description": "Ranked positive/negative contributors.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "rank": {"type": "integer"},
                            "name": {"type": "string"},
                            "dimension": {"type": "string"},
                            "baseline": {"type": "string"},
                            "current": {"type": "string"},
                            "delta": {"type": "string"},
                            "contribution_pct": {"type": "number"},
                            "baseline_raw": {"type": "number"},
                            "current_raw": {"type": "number"},
                            "delta_raw": {"type": "number"},
                            "direction": {"type": "string", "enum": ["positive", "negative", "neutral"]},
                            "evidence_ids": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["name"],
                    },
                },
                "charts": {
                    "type": "array",
                    "description": (
                        "echarts charts; data inline. Types: line/bar/bar_horizontal/"
                        "stacked_bar/pie. Prefer bar_horizontal for ranking many named "
                        "categories (e.g. Top-N customers) — long labels read cleanly on "
                        "the Y axis instead of overlapping on the X axis."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "enum": ["line", "bar", "bar_horizontal", "stacked_bar", "pie"]},
                            "title": {"type": "string"},
                            "x": {"type": "array", "items": {"type": "string"}, "description": "Category axis (line/bar). For bar_horizontal these become the Y-axis labels."},
                            "series": {
                                "type": "array",
                                "description": "line/bar: [{name, data:[num]}]; pie: [{name, value}].",
                                "items": {"type": "object"},
                            },
                            "caption": {"type": "string"},
                            "height": {"type": "integer"},
                        },
                        "required": ["type", "series"],
                    },
                },
                "table": {
                    "type": "object",
                    "description": "Detail table.",
                    "properties": {
                        "columns": {"type": "array", "items": {"type": "string"}},
                        "numeric": {"type": "array", "items": {"type": "boolean"}, "description": "Per-column: right-align as number."},
                        "rows": {"type": "array", "items": {"type": "array"}},
                        "note": {"type": "string"},
                    },
                },
                "insights": {
                    "type": "array",
                    "description": "Attribution/insight lines, each tagged.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["fact", "inference", "hypothesis", "recommendation"]},
                            "text": {"type": "string"},
                            "evidence_ids": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["kind", "text"],
                    },
                },
                "caliber": {
                    "type": "array",
                    "description": "Metric caliber & source declarations. Set custom=true for unverified self-written SQL.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "metric": {"type": "string", "description": "Metric name this caliber applies to (optional)."},
                            "desc": {"type": "string"},
                            "custom": {"type": "boolean"},
                        },
                        "required": ["desc"],
                    },
                },
                "caveats": {"type": "array", "items": {"type": "string"}, "description": "Risks / to-confirm items."},
                "evidence": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Optional evidence index used by attribution findings.",
                },
                "trace_id": {"type": "string", "description": "Optional analysis trace identifier."},
            },
            "required": ["title", "identifier"],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        title = args.get("title")
        identifier = args.get("identifier")
        if not title or not identifier:
            return ToolResult(error="build_report requires 'title' and 'identifier'.")

        spec = {k: v for k, v in args.items() if k != "identifier"}
        try:
            spec = compile_attribution_spec(spec)
            html = render_report(spec)
        except Exception as e:  # noqa: BLE001
            log.exception("build_report render failed")
            return ToolResult(error=f"报告渲染失败: {e}")

        # Write the report to disk so the frontend can open it directly in the
        # system browser (desktop). Falls back gracefully if the write fails —
        # the inline artifact content still renders in the preview panel.
        file_path: str | None = None
        try:
            out = _report_output_dir(ctx.workspace) / _safe_filename(identifier)
            out.write_text(html, encoding="utf-8")
            file_path = str(out)
        except Exception:  # noqa: BLE001
            log.warning("build_report failed to write report file", exc_info=True)

        where = f"已保存到 {file_path}," if file_path else ""
        # Same metadata shape the `artifact` tool emits (frontend opens it in the
        # preview panel) plus file_path so the panel's "本地打开" opens the saved file.
        return ToolResult(
            output=f"报告「{title}」已生成,{where}在右侧产物面板查看,可点「本地打开」用浏览器打开完整交互报告。",
            title=title,
            metadata={
                "command": "create",
                "type": "html",
                "title": title,
                "identifier": identifier,
                "content": html,
                "file_path": file_path,
                "report_type": spec.get("report_type") or "general",
                "analysis_type": spec.get("analysis_type"),
                "trace_id": spec.get("trace_id"),
                "evidence_count": len(spec.get("evidence") or []),
            },
        )
