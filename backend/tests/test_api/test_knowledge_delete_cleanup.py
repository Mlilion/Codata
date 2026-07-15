"""Deleting a knowledge entry should best-effort remove its raw snapshot."""

from __future__ import annotations

import pytest

# Ensure the KnowledgeEntry table is registered on Base.metadata before the
# db_engine fixture runs create_all (import happens at collection time).
from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401
from app.knowledge import wiki_store
from app.models.knowledge_entry import KnowledgeEntry


@pytest.mark.asyncio
async def test_delete_removes_raw_file(
    app_client, tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    raw = wiki_store.raw_dir() / "e9.md"
    raw.write_text("x", encoding="utf-8")
    assert raw.exists()

    # Seed directly into the DB the client uses (shared session_factory/engine).
    async with session_factory() as session:
        async with session.begin():
            session.add(
                KnowledgeEntry(
                    id="e9",
                    feishu_url="u",
                    feishu_token="t",
                    doc_type="docx",
                    raw_path="raw/e9.md",
                )
            )

    resp = await app_client.delete("/api/knowledge/e9")
    assert resp.status_code == 200, resp.text
    assert not raw.exists()
