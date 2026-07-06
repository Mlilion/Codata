"""Shared helpers for reaching the datasage MCP server from backend code.

Both the dashboard-refresh endpoint and the run_query orchestration tool need
to find the connected datasage client and pull text out of a tool call. The
datasage server name is user-configurable, so we locate it by the tool it
exposes (``execute_sql``) rather than by a fixed name — same principle as the
datasage result parser's suffix matching.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _manager_from_singleton():
    """Resolve the MCP manager via the module-level connector registry."""
    try:
        from app.dependencies import get_connector_registry

        registry = get_connector_registry()
    except Exception:
        return None
    return getattr(registry, "mcp_manager", None) or getattr(registry, "_mcp_manager", None)


def find_execute_sql_client(manager: Any | None = None):
    """Return a connected MCP client exposing an ``execute_sql`` tool, or None.

    When ``manager`` is omitted it's resolved from the connector-registry
    singleton (works inside tool execution, which has no request/app.state).
    """
    if manager is None:
        manager = _manager_from_singleton()
    if manager is None:
        return None
    for client in getattr(manager, "_clients", {}).values():
        if getattr(client, "status", None) != "connected":
            continue
        try:
            tool_names = {t.name for t in client.list_tools()}
        except Exception:
            continue
        if "execute_sql" in tool_names:
            return client
    return None


def extract_text(call_result: Any) -> str:
    """Join the text content items of an MCP CallToolResult."""
    parts = [
        item.text
        for item in getattr(call_result, "content", [])
        if getattr(item, "type", None) == "text"
    ]
    return "\n".join(parts)
