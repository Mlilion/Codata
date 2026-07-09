"""Locate the connected Feishu MCP client and read a document's body.

The Feishu MCP server name is user-configurable, so we locate the client by
a tool it exposes (a Feishu doc-read tool) rather than by a fixed server name
— same principle as app/mcp/datasage_client.find_execute_sql_client.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Tool names any Feishu MCP (official lark-openapi-mcp) exposes for reading a
# document body. We match on presence of any of these.
_FEISHU_READ_TOOLS = (
    "docx.v1.document.rawContent",
    "docx_v1_document_rawContent",
    "docx.builtin.search",
)


def _manager_from_singleton():
    try:
        from app.dependencies import get_connector_registry

        registry = get_connector_registry()
    except Exception:
        return None
    return getattr(registry, "mcp_manager", None) or getattr(registry, "_mcp_manager", None)


def find_feishu_client(manager: Any | None = None):
    """Return a connected MCP client exposing a Feishu doc-read tool, or None."""
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
        if any(name in tool_names for name in _FEISHU_READ_TOOLS):
            return client
    return None


def _rawcontent_tool_name(client) -> str | None:
    try:
        names = {t.name for t in client.list_tools()}
    except Exception:
        return None
    for candidate in ("docx.v1.document.rawContent", "docx_v1_document_rawContent"):
        if candidate in names:
            return candidate
    return None


async def read_feishu_doc(client, doc_type: str, token: str) -> str:
    """Read a Feishu doc body as plain text via the MCP client.

    First-cut supports docx via rawContent. Other types raise a clear error.
    """
    if doc_type != "docx":
        raise ValueError(f"暂只支持读取 docx 文档,当前类型: {doc_type}")
    tool = _rawcontent_tool_name(client)
    if tool is None:
        raise RuntimeError("飞书 MCP 未提供文档读取工具")
    result = await client.call_tool(tool, {"document_id": token})
    from app.mcp.datasage_client import extract_text

    return extract_text(result)
