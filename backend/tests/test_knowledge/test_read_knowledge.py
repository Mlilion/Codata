from __future__ import annotations

import pytest

from app.knowledge.feishu_reader import find_feishu_client


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
