"""MCP tool wrapper — adapts an MCP tool to the Codata ToolDefinition interface."""

from __future__ import annotations

import json
import logging
from typing import Any, TYPE_CHECKING

from app.tool.base import ToolDefinition, ToolResult

if TYPE_CHECKING:
    from app.mcp.client import McpClient
    from app.tool.context import ToolContext
    from mcp.types import Tool as McpTool

logger = logging.getLogger(__name__)

_AUTH_REQUIRED_PREFIX = "CODATA_AUTH_REQUIRED:"


def _parse_interactive_auth_error(error: str) -> tuple[str, dict[str, Any]]:
    """Decode a connector's auth marker and remove it from the displayed error."""
    marker_start = error.find(_AUTH_REQUIRED_PREFIX)
    if marker_start < 0:
        return error, {}
    marker_lines = error[marker_start + len(_AUTH_REQUIRED_PREFIX):].splitlines()
    if not marker_lines:
        return error, {}
    marker = marker_lines[0]
    try:
        payload = json.loads(marker)
    except (json.JSONDecodeError, TypeError):
        return error, {}
    if not isinstance(payload, dict):
        return error, {}
    connector_id = payload.get("connector_id")
    service = payload.get("service")
    if not all(isinstance(value, str) and value.strip() for value in (connector_id, service)):
        return error, {}
    marker_line = f"{_AUTH_REQUIRED_PREFIX}{marker}"
    display_error = error.replace(marker_line, "", 1).strip() or f"Authentication required for {service}"
    return display_error, {
        "needs_interactive_auth": True,
        "connector_id": connector_id,
        "service": service,
        "reason": payload.get("reason", "session_expired"),
    }


def _schema_for_container(schema: Any, container_type: str) -> dict[str, Any] | None:
    """Find the branch of a JSON Schema that describes an array or object."""
    if not isinstance(schema, dict):
        return None

    schema_type = schema.get("type")
    schema_types = schema_type if isinstance(schema_type, list) else [schema_type]
    if container_type in schema_types:
        return schema

    # Pydantic emits Optional[list[...]] as anyOf(array, null). Some MCP
    # servers use oneOf/allOf for the same kind of wrapper.
    for keyword in ("anyOf", "oneOf", "allOf"):
        branches = schema.get(keyword)
        if not isinstance(branches, list):
            continue
        for branch in branches:
            match = _schema_for_container(branch, container_type)
            if match is not None:
                return match
    return None


def _normalize_json_container(value: Any, schema: Any) -> Any:
    """Decode JSON-stringified containers only when the schema requires one."""
    array_schema = _schema_for_container(schema, "array")
    object_schema = _schema_for_container(schema, "object")

    if isinstance(value, str) and (array_schema is not None or object_schema is not None):
        try:
            decoded = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            decoded = value
        if isinstance(decoded, list) and array_schema is not None:
            value = decoded
        elif isinstance(decoded, dict) and object_schema is not None:
            value = decoded

    if isinstance(value, list) and array_schema is not None:
        item_schema = array_schema.get("items", {})
        return [_normalize_json_container(item, item_schema) for item in value]

    if isinstance(value, dict) and object_schema is not None:
        properties = object_schema.get("properties", {})
        if not isinstance(properties, dict):
            return value
        return {
            key: _normalize_json_container(item, properties.get(key, {}))
            for key, item in value.items()
        }

    return value


class McpToolWrapper(ToolDefinition):
    """Wraps an MCP server tool as a Codata ToolDefinition.

    Tool ID: ``{server_name}_{tool_name}`` (sanitised).
    """

    def __init__(self, client: "McpClient", mcp_tool: "McpTool") -> None:
        self._client = client
        self._mcp_tool = mcp_tool
        self._tool_id = client.tool_id(mcp_tool.name)

    @property
    def id(self) -> str:
        return self._tool_id

    @property
    def description(self) -> str:
        desc = self._mcp_tool.description or f"MCP tool from {self._client.name}"
        return f"[MCP: {self._client.name}] {desc}"

    def parameters_schema(self) -> dict[str, Any]:
        schema = self._mcp_tool.inputSchema
        if isinstance(schema, dict):
            # Ensure it has type: object for OpenAI function calling
            result = dict(schema)
            result.setdefault("type", "object")
            result.setdefault("properties", {})
            return result
        return {"type": "object", "properties": {}}

    def normalize_args(self, args: dict[str, Any]) -> dict[str, Any]:
        """Repair model-emitted JSON strings for schema-declared containers."""
        normalized = _normalize_json_container(args, self.parameters_schema())
        return normalized if isinstance(normalized, dict) else args

    async def execute(self, args: dict[str, Any], ctx: "ToolContext") -> ToolResult:
        try:
            result = await self._client.call_tool(self._mcp_tool.name, args)
        except Exception as e:
            error = f"MCP tool call failed: {e}"
            error, metadata = _parse_interactive_auth_error(error)
            return ToolResult(error=error, metadata=metadata)

        # Convert MCP result content to ToolResult
        text_parts: list[str] = []
        attachments: list[dict[str, Any]] = []

        for item in result.content:
            if item.type == "text":
                text_parts.append(item.text)
            elif item.type == "image":
                attachments.append({
                    "type": "file",
                    "mime_type": getattr(item, "mimeType", "image/png"),
                    "url": f"data:{getattr(item, 'mimeType', 'image/png')};base64,{item.data}",
                })
            elif item.type == "resource":
                resource = item.resource
                if hasattr(resource, "text") and resource.text:
                    text_parts.append(resource.text)
                elif hasattr(resource, "blob") and resource.blob:
                    attachments.append({
                        "type": "file",
                        "mime_type": getattr(resource, "mimeType", "application/octet-stream"),
                        "url": f"data:{getattr(resource, 'mimeType', 'application/octet-stream')};base64,{resource.blob}",
                    })

        output = "\n".join(text_parts)

        if result.isError:
            error = output or "MCP tool returned an error"
            error, metadata = _parse_interactive_auth_error(error)
            return ToolResult(error=error, metadata=metadata)

        # Structure known datasage results into metadata so the frontend can
        # render SQL / tables / charts instead of a raw text blob.
        metadata: dict[str, Any] = {}
        try:
            from app.mcp.datasage_parser import parse_datasage_result

            parsed = parse_datasage_result(self._tool_id, args, output)
            if parsed:
                metadata.update(parsed)
        except Exception:
            logger.debug("datasage metadata parse failed", exc_info=True)

        return ToolResult(
            output=output,
            metadata=metadata,
            title=f"{self._client.name}/{self._mcp_tool.name}",
            attachments=attachments,
        )
