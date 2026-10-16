"""Tests for app.mcp.tool_wrapper — MCP tool schema normalization."""

from __future__ import annotations

import pytest

pytest.importorskip("mcp")

from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.mcp.tool_wrapper import McpToolWrapper, _parse_interactive_auth_error


def _make_wrapper(input_schema: dict | None = None, description: str = "A tool") -> McpToolWrapper:
    client = SimpleNamespace(name="slack", tool_id=lambda name: f"slack_{name}")
    mcp_tool = SimpleNamespace(
        name="send_message",
        description=description,
        inputSchema=input_schema or {"type": "object", "properties": {"text": {"type": "string"}}},
    )
    return McpToolWrapper(client, mcp_tool)


class TestMcpToolWrapperSchema:
    def test_ensures_type_object(self):
        wrapper = _make_wrapper({"properties": {"x": {"type": "string"}}})
        schema = wrapper.parameters_schema()
        assert schema["type"] == "object"

    def test_ensures_properties_dict(self):
        wrapper = _make_wrapper({"type": "object"})
        schema = wrapper.parameters_schema()
        assert schema["properties"] == {}

    def test_passthrough_valid_schema(self):
        original = {"type": "object", "properties": {"x": {"type": "string"}}, "required": ["x"]}
        wrapper = _make_wrapper(original)
        schema = wrapper.parameters_schema()
        assert schema["required"] == ["x"]
        assert "x" in schema["properties"]


class TestMcpToolWrapperArgumentNormalization:
    def test_decodes_json_string_for_array_parameters(self):
        wrapper = _make_wrapper({
            "type": "object",
            "properties": {
                "indicator_codes": {"type": "array", "items": {"type": "string"}},
                "dimension_codes": {"type": "array", "items": {"type": "string"}},
            },
        })

        args = wrapper.normalize_args({
            "indicator_codes": '["poc_ind_ac2_sales"]',
            "dimension_codes": '["report_province"]',
        })

        assert args == {
            "indicator_codes": ["poc_ind_ac2_sales"],
            "dimension_codes": ["report_province"],
        }

    def test_decodes_pydantic_optional_array_schema(self):
        wrapper = _make_wrapper({
            "type": "object",
            "properties": {
                "indicator_codes": {
                    "anyOf": [
                        {"type": "array", "items": {"type": "string"}},
                        {"type": "null"},
                    ],
                    "default": None,
                },
            },
        })

        args = wrapper.normalize_args({"indicator_codes": '["sales"]'})

        assert args["indicator_codes"] == ["sales"]

    def test_does_not_decode_parameters_declared_as_strings(self):
        wrapper = _make_wrapper({
            "type": "object",
            "properties": {"query": {"type": "string"}},
        })

        args = wrapper.normalize_args({"query": '["keep", "as", "text"]'})

        assert args["query"] == '["keep", "as", "text"]'

    @pytest.mark.asyncio
    async def test_normalizes_before_validation_and_mcp_call(self):
        wrapper = _make_wrapper({
            "type": "object",
            "properties": {
                "indicator_codes": {"type": "array", "items": {"type": "string"}},
            },
        })
        wrapper._client.call_tool = AsyncMock(return_value=SimpleNamespace(
            content=[],
            isError=False,
        ))

        result = await wrapper(
            {"indicator_codes": '["poc_ind_ac2_sales"]'},
            SimpleNamespace(),
        )

        assert result.error is None
        wrapper._client.call_tool.assert_awaited_once_with(
            "send_message",
            {"indicator_codes": ["poc_ind_ac2_sales"]},
        )


class TestMcpToolWrapperDescription:
    def test_prefixes_server_name(self):
        wrapper = _make_wrapper(description="Send a message")
        assert wrapper.description.startswith("[MCP: slack]")
        assert "Send a message" in wrapper.description


class TestMcpToolWrapperInteractiveAuth:
    @pytest.mark.asyncio
    async def test_decodes_auth_required_error_result(self):
        wrapper = _make_wrapper()
        wrapper._client.call_tool = AsyncMock(return_value=SimpleNamespace(
            content=[SimpleNamespace(
                type="text",
                text=(
                    'CODATA_AUTH_REQUIRED:{"connector_id":"slack",'
                    '"service":"workspace","reason":"session_expired"}\nLogin required'
                ),
            )],
            isError=True,
        ))

        result = await wrapper.execute({}, SimpleNamespace())

        assert result.error == "Login required"
        assert result.metadata == {
            "needs_interactive_auth": True,
            "connector_id": "slack",
            "service": "workspace",
            "reason": "session_expired",
        }

    @pytest.mark.asyncio
    async def test_decodes_auth_required_exception(self):
        wrapper = _make_wrapper()
        wrapper._client.call_tool = AsyncMock(side_effect=RuntimeError(
            'CODATA_AUTH_REQUIRED:{"connector_id":"slack","service":"workspace"}'
        ))

        result = await wrapper.execute({}, SimpleNamespace())

        assert result.error == "MCP tool call failed:"
        assert result.metadata == {
            "needs_interactive_auth": True,
            "connector_id": "slack",
            "service": "workspace",
            "reason": "session_expired",
        }

    @pytest.mark.parametrize("payload", [
        "", "invalid", "null", "[]", '"text"', "{}",
        '{"connector_id":"slack"}',
        '{"connector_id":"","service":"workspace"}',
        '{"connector_id":"slack","service":" "}',
        '{"connector_id":123,"service":"workspace"}',
        '{"connector_id":"slack","service":[]}',
    ])
    def test_preserves_invalid_auth_markers(self, payload):
        error = f"CODATA_AUTH_REQUIRED:{payload}"

        assert _parse_interactive_auth_error(error) == (error, {})

    def test_auth_marker_without_message_uses_generic_fallback(self):
        error = 'CODATA_AUTH_REQUIRED:{"connector_id":"example","service":"portal"}'

        message, metadata = _parse_interactive_auth_error(error)

        assert message == "Authentication required for portal"
        assert metadata["connector_id"] == "example"
        assert metadata["service"] == "portal"

    @pytest.mark.asyncio
    async def test_does_not_classify_regular_mcp_error(self):
        wrapper = _make_wrapper()
        wrapper._client.call_tool = AsyncMock(return_value=SimpleNamespace(
            content=[SimpleNamespace(type="text", text="HTTP 401 from another MCP")],
            isError=True,
        ))

        result = await wrapper.execute({}, SimpleNamespace())

        assert result.error == "HTTP 401 from another MCP"
        assert result.metadata == {}
