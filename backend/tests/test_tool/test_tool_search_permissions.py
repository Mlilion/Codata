from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.agent.agent import AgentRegistry
from app.mcp.tool_wrapper import McpToolWrapper
from app.tool.builtin.tool_search import ToolSearchTool
from app.tool.context import ToolContext
from app.tool.registry import ToolRegistry


class _Client:
    name = "codata"

    @staticmethod
    def tool_id(name: str) -> str:
        return f"codata_{name}"


def _wrapper(name: str) -> McpToolWrapper:
    return McpToolWrapper(
        _Client(),
        SimpleNamespace(name=name, description=name, inputSchema={"type": "object", "properties": {}}),
    )


@pytest.mark.asyncio
async def test_data_agent_cannot_discover_denied_execute_sql():
    registry = ToolRegistry()
    registry.register(_wrapper("execute_sql"))
    registry.register(_wrapper("query_indicator"))
    discovered: set[str] = set()
    agent = AgentRegistry().get("data")
    assert agent is not None
    ctx = ToolContext(session_id="s", message_id="m", agent=agent, call_id="c", discovered_tools=discovered)
    tool = ToolSearchTool(registry)
    assert "codata_execute_sql" not in tool.description

    denied = await tool.execute({"query": "execute_sql"}, ctx)
    assert "No matching deferred tools" in denied.output
    assert "codata_execute_sql" not in discovered

    allowed = await tool.execute({"query": "query_indicator"}, ctx)
    assert allowed.success
    assert "codata_query_indicator" in discovered
