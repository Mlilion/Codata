"""Read a Feishu document's body via the native ``lark_oapi`` SDK.

Uses tenant-token auth off the Feishu channel credentials (no external MCP
process). Supports docx documents and wiki nodes (which are resolved to their
backing docx document before reading).

The ``lark_oapi`` calls are synchronous, so they are wrapped in the running
loop's default executor to stay non-blocking.
"""
from __future__ import annotations

import asyncio
from typing import Any

from app.knowledge.feishu_client import get_feishu_client

__all__ = ["read_feishu_doc"]


def _require_client(client: Any | None) -> Any:
    if client is not None:
        return client
    client = get_feishu_client()
    if client is None:
        raise RuntimeError(
            "飞书未配置:请先在渠道设置里填写飞书应用 App ID/Secret"
        )
    return client


def _read_docx_sync(client: Any, document_id: str) -> str:
    from lark_oapi.api.docx.v1 import RawContentDocumentRequest

    req = RawContentDocumentRequest.builder().document_id(document_id).build()
    resp = client.docx.v1.document.raw_content(req)
    if not resp.success():
        raise RuntimeError(
            f"读取飞书文档失败(code={resp.code}): {resp.msg}. "
            "请确认该文档已授权给此飞书应用,且应用已开通云文档只读权限。"
        )
    return resp.data.content or ""


def _resolve_wiki_sync(client: Any, node_token: str) -> str:
    from lark_oapi.api.wiki.v2 import GetNodeSpaceRequest

    req = (
        GetNodeSpaceRequest.builder()
        .token(node_token)
        .obj_type("wiki")
        .build()
    )
    resp = client.wiki.v2.space.get_node(req)
    if not resp.success():
        raise RuntimeError(
            f"解析飞书知识库节点失败(code={resp.code}): {resp.msg}. "
            "请确认该知识库节点已授权给此飞书应用,且应用已开通知识库只读权限。"
        )
    node = resp.data.node
    if node.obj_type != "docx":
        raise RuntimeError(
            f"暂只支持 docx 类型的飞书文档,当前类型: {node.obj_type}"
        )
    return node.obj_token


async def read_feishu_doc(client: Any, doc_type: str, token: str) -> str:
    """Read a Feishu doc body as plain text via the native lark_oapi client.

    ``client`` may be ``None``, in which case a client is built from the Feishu
    channel credentials. ``doc_type`` is ``"docx"`` or ``"wiki"``.
    """
    c = _require_client(client)
    loop = asyncio.get_running_loop()

    if doc_type == "wiki":
        obj_token = await loop.run_in_executor(None, _resolve_wiki_sync, c, token)
        return await loop.run_in_executor(None, _read_docx_sync, c, obj_token)
    if doc_type == "docx":
        return await loop.run_in_executor(None, _read_docx_sync, c, token)
    raise RuntimeError(f"暂只支持 docx/wiki 类型的飞书文档,当前类型: {doc_type}")
