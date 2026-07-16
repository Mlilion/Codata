"""Tests for read_feishu_doc via the native lark_oapi SDK (tenant token).

The fake client mirrors the real lark_oapi client nesting:
- docx read:  client.docx.v1.document.raw_content(req)
- wiki node:  client.wiki.v2.space.get_node(req)
Responses expose .success() / .code / .msg / .data.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.knowledge import feishu_reader


def _docx_resp(*, ok: bool, content: str = "", code: int = 0, msg: str = "ok"):
    return SimpleNamespace(
        success=lambda: ok,
        code=code,
        msg=msg,
        data=SimpleNamespace(content=content),
    )


def _wiki_resp(*, ok: bool, obj_token: str = "", obj_type: str = "docx", code: int = 0, msg: str = "ok"):
    node = SimpleNamespace(obj_token=obj_token, obj_type=obj_type, title="T")
    return SimpleNamespace(
        success=lambda: ok,
        code=code,
        msg=msg,
        data=SimpleNamespace(node=node),
    )


def _make_client(*, docx_resp=None, wiki_resp=None):
    return SimpleNamespace(
        docx=SimpleNamespace(
            v1=SimpleNamespace(
                document=SimpleNamespace(raw_content=lambda req: docx_resp),
            )
        ),
        wiki=SimpleNamespace(
            v2=SimpleNamespace(
                space=SimpleNamespace(get_node=lambda req: wiki_resp),
            )
        ),
    )


async def test_read_docx_ok():
    client = _make_client(docx_resp=_docx_resp(ok=True, content="hello body"))
    out = await feishu_reader.read_feishu_doc(client, "docx", "DOCTOKEN")
    assert out == "hello body"


async def test_read_wiki_resolves_then_reads_docx():
    client = _make_client(
        wiki_resp=_wiki_resp(ok=True, obj_token="OBJ123", obj_type="docx"),
        docx_resp=_docx_resp(ok=True, content="wiki body"),
    )
    # sanity: the docx call should be against the resolved obj_token
    seen = {}

    def raw_content(req):
        seen["document_id"] = req.document_id
        return _docx_resp(ok=True, content="wiki body")

    client.docx.v1.document.raw_content = raw_content
    out = await feishu_reader.read_feishu_doc(client, "wiki", "NODETOKEN")
    assert out == "wiki body"
    assert seen["document_id"] == "OBJ123"


async def test_wiki_non_docx_obj_type_raises():
    client = _make_client(wiki_resp=_wiki_resp(ok=True, obj_token="OBJ", obj_type="sheet"))
    with pytest.raises(RuntimeError, match="docx"):
        await feishu_reader.read_feishu_doc(client, "wiki", "NODETOKEN")


async def test_docx_permission_failure_raises():
    client = _make_client(docx_resp=_docx_resp(ok=False, code=99991672, msg="permission denied"))
    with pytest.raises(RuntimeError, match="读取飞书文档失败"):
        await feishu_reader.read_feishu_doc(client, "docx", "DOCTOKEN")


async def test_wiki_resolve_failure_raises():
    client = _make_client(wiki_resp=_wiki_resp(ok=False, code=131006, msg="node not found"))
    with pytest.raises(RuntimeError):
        await feishu_reader.read_feishu_doc(client, "wiki", "NODETOKEN")


async def test_unsupported_doc_type_raises():
    client = _make_client()
    with pytest.raises(RuntimeError, match="docx/wiki"):
        await feishu_reader.read_feishu_doc(client, "sheet", "TOK")


async def test_none_client_and_no_config_raises(monkeypatch):
    monkeypatch.setattr(feishu_reader, "get_feishu_client", lambda: None)
    with pytest.raises(RuntimeError, match="飞书未配置"):
        await feishu_reader.read_feishu_doc(None, "docx", "TOK")


async def test_none_client_uses_get_feishu_client(monkeypatch):
    client = _make_client(docx_resp=_docx_resp(ok=True, content="from-config"))
    monkeypatch.setattr(feishu_reader, "get_feishu_client", lambda: client)
    out = await feishu_reader.read_feishu_doc(None, "docx", "TOK")
    assert out == "from-config"
