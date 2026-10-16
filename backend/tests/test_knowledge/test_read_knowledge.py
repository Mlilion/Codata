from __future__ import annotations

import pytest

from app.knowledge.feishu_reader import read_feishu_doc


class _Resp:
    def __init__(self, data, ok=True, code=0, msg="ok"):
        self.data = data
        self._ok = ok
        self.code = code
        self.msg = msg

    def success(self):
        return self._ok


class _DocData:
    def __init__(self, content):
        self.content = content


class _Node:
    def __init__(self, obj_type, obj_token):
        self.obj_type = obj_type
        self.obj_token = obj_token


class _NodeData:
    def __init__(self, node):
        self.node = node


class _RawContent:
    def __init__(self, content):
        self._content = content
        self.requests: list = []

    def raw_content(self, req):
        self.requests.append(req)
        return _Resp(_DocData(self._content))


class _SpaceNode:
    def __init__(self, node):
        self._node = node
        self.requests: list = []

    def get_node(self, req):
        self.requests.append(req)
        return _Resp(_NodeData(self._node))


class _FakeClient:
    """Mimics the native lark_oapi client surface used by read_feishu_doc."""

    def __init__(self, content="文档正文", node=None):
        raw = _RawContent(content)
        self.docx = type("D", (), {"v1": type("V", (), {"document": raw})()})()
        space = _SpaceNode(node) if node is not None else None
        self.wiki = type("W", (), {"v2": type("V", (), {"space": space})()})()
        self._raw = raw
        self._space = space


@pytest.mark.anyio
async def test_read_feishu_doc_reads_docx():
    client = _FakeClient(content="文档正文")
    body = await read_feishu_doc(client, "docx", "TOK123")
    assert body == "文档正文"
    assert len(client._raw.requests) == 1


@pytest.mark.anyio
async def test_read_feishu_doc_resolves_wiki_to_docx():
    client = _FakeClient(content="维基正文", node=_Node("docx", "DOCTOK"))
    body = await read_feishu_doc(client, "wiki", "NODE123")
    assert body == "维基正文"
    assert len(client._space.requests) == 1
    assert len(client._raw.requests) == 1


@pytest.mark.anyio
async def test_read_feishu_doc_rejects_unsupported_type():
    client = _FakeClient()
    with pytest.raises(RuntimeError):
        await read_feishu_doc(client, "sheet", "TOK123")
