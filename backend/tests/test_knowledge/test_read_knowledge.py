from __future__ import annotations

import pytest

from app.knowledge.feishu_reader import find_feishu_client, read_feishu_doc


class _Tool:
    def __init__(self, name): self.name = name


class _Client:
    def __init__(self, tools, status="connected"):
        self.status = status
        self._tools = tools
    def list_tools(self):
        return [_Tool(t) for t in self._tools]


class _Manager:
    def __init__(self, clients):
        self._clients = clients


class _ContentItem:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class _CallResult:
    def __init__(self, text):
        self.content = [_ContentItem(text)]


class _RecordingClient:
    """Captures the exact (name, arguments) passed to call_tool."""

    def __init__(self, tools):
        self.status = "connected"
        self._tools = tools
        self.calls: list[tuple] = []

    def list_tools(self):
        return [_Tool(t) for t in self._tools]

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        return _CallResult('{"content":"文档正文"}')


def test_find_feishu_client_by_tool_name():
    mgr = _Manager({
        "a": _Client(["execute_sql"]),
        "b": _Client(["docx.v1.document.rawContent", "wiki.v2.space.getNode"]),
    })
    client = find_feishu_client(mgr)
    assert client is mgr._clients["b"]


def test_find_feishu_client_skips_disconnected():
    mgr = _Manager({
        "b": _Client(["docx.v1.document.rawContent"], status="failed"),
    })
    assert find_feishu_client(mgr) is None


def test_find_feishu_client_none_when_absent():
    mgr = _Manager({"a": _Client(["execute_sql"])})
    assert find_feishu_client(mgr) is None


def test_find_feishu_client_matches_underscore_tool_name():
    # lark-openapi-mcp actually exposes the underscore form, not the dotted one.
    mgr = _Manager({"b": _Client(["docx_v1_document_rawContent"])})
    assert find_feishu_client(mgr) is mgr._clients["b"]


@pytest.mark.anyio
async def test_read_feishu_doc_nests_document_id_under_path():
    # Regression: lark-openapi-mcp's rawContent inputSchema requires the doc id
    # nested under a top-level ``path`` object. A flat {"document_id": ...} fails
    # schema validation before reaching Feishu. Lock the exact call shape.
    client = _RecordingClient(["docx_v1_document_rawContent"])
    await read_feishu_doc(client, "docx", "TOK123")
    assert len(client.calls) == 1
    name, args = client.calls[0]
    assert name == "docx_v1_document_rawContent"
    assert args == {"path": {"document_id": "TOK123"}}


@pytest.mark.anyio
async def test_read_feishu_doc_rejects_non_docx():
    client = _RecordingClient(["docx_v1_document_rawContent"])
    with pytest.raises(ValueError):
        await read_feishu_doc(client, "wiki", "TOK123")
    assert client.calls == []  # no MCP call attempted for unsupported type
