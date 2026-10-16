"""Compile attribution findings into deterministic contributions and rankings."""

from __future__ import annotations

import json
from typing import Any

from app.report.attribution import compile_attribution_spec
from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext


class CompileAttributionTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "compile_attribution"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return (
            "Normalize an attribution analysis before the final answer. Given the target "
            "metric, optional numeric baseline/current/delta values, drivers, findings, "
            "and evidence ids, this tool deterministically calculates contribution shares, "
            "directions, ranks, explained percentage, and validates evidence references. "
            "It also returns delivery.report_recommended so complex attribution can automatically "
            "produce an HTML report. Use after querying evidence; it does not query data or claim causality."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "analysis_type": {"type": "string"},
                "attribution": {
                    "type": "object",
                    "properties": {
                        "target_metric": {"type": "string"},
                        "baseline_value": {"type": "string"},
                        "current_value": {"type": "string"},
                        "delta_value": {"type": "string"},
                        "baseline_raw": {"type": "number"},
                        "current_raw": {"type": "number"},
                        "delta_raw": {"type": "number"},
                        "delta_pct": {"type": "number"},
                        "explained_pct": {"type": "number"},
                        "method": {"type": "string"},
                        "causal_claim": {"type": "boolean"},
                    },
                },
                "drivers": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "dimension": {"type": "string"},
                            "baseline": {"type": "string"},
                            "current": {"type": "string"},
                            "delta": {"type": "string"},
                            "baseline_raw": {"type": "number"},
                            "current_raw": {"type": "number"},
                            "delta_raw": {"type": "number"},
                            "contribution_pct": {"type": "number"},
                            "direction": {"type": "string", "enum": ["positive", "negative", "neutral"]},
                            "evidence_ids": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["name"],
                    },
                },
                "insights": {"type": "array", "items": {"type": "object"}},
                "evidence": {"type": "array", "items": {"type": "object"}},
                "caveats": {"type": "array", "items": {"type": "string"}},
                "trace_id": {"type": "string"},
            },
            "required": ["attribution", "drivers"],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        del ctx
        try:
            compiled = compile_attribution_spec({"report_type": "attribution", **args})
        except ValueError as exc:
            return ToolResult(error=str(exc))
        return ToolResult(
            output=json.dumps(compiled, ensure_ascii=False, separators=(",", ":")),
            title="归因结果已整理",
            metadata={
                "codata_kind": "attribution_summary",
                "visibility": "trace",
                "result_role": "attribution-compile",
                "attribution": compiled.get("attribution"),
                "drivers": compiled.get("drivers"),
                "evidence": compiled.get("evidence"),
                "trace_id": compiled.get("trace_id"),
                "delivery": compiled.get("delivery"),
            },
        )
