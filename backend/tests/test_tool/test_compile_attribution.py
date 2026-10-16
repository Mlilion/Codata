from __future__ import annotations

import json

import pytest

from app.schemas.agent import AgentInfo
from app.tool.builtin.compile_attribution import CompileAttributionTool
from app.tool.context import ToolContext


def _ctx() -> ToolContext:
    return ToolContext(
        session_id="s",
        message_id="m",
        agent=AgentInfo(name="data", description="", mode="primary"),
        call_id="c",
    )


@pytest.mark.asyncio
async def test_compile_attribution_returns_deterministic_summary():
    result = await CompileAttributionTool().execute({
        "attribution": {"baseline_raw": 100, "current_raw": 150, "causal_claim": False},
        "drivers": [
            {"name": "上海", "delta_raw": 10},
            {"name": "北京", "delta_raw": 40},
        ],
    }, _ctx())

    assert result.success
    payload = json.loads(result.output)
    assert payload["attribution"]["explained_pct"] == 100
    assert payload["drivers"][0]["name"] == "北京"
    assert payload["drivers"][0]["contribution_pct"] == 80
    assert result.metadata["visibility"] == "trace"
    assert result.metadata["delivery"]["report_recommended"] is False


@pytest.mark.asyncio
async def test_compile_attribution_rejects_unknown_evidence():
    result = await CompileAttributionTool().execute({
        "attribution": {},
        "drivers": [{"name": "北京", "evidence_ids": ["missing"]}],
        "evidence": [{"evidence_id": "ev_1"}],
    }, _ctx())
    assert not result.success
    assert "Unknown attribution evidence" in (result.error or "")
