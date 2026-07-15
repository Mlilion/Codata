"""Ingest a knowledge entry: snapshot raw text, then build wiki pages."""
from __future__ import annotations

from app.knowledge.feishu_reader import find_feishu_client, read_feishu_doc
from app.knowledge import wiki_store


async def snapshot_raw(entry) -> str:
    client = find_feishu_client()
    if client is None:
        raise RuntimeError("飞书未连接")
    body = await read_feishu_doc(client, entry.doc_type, entry.feishu_token)
    path = wiki_store.raw_dir() / f"{entry.id}.md"
    path.write_text(body, encoding="utf-8")
    return f"raw/{entry.id}.md"
