from __future__ import annotations
import pytest
from app.knowledge import wiki_store

# Ensure the KnowledgeEntry table is registered on Base.metadata before the
# db_engine fixture runs create_all (import happens at collection time).
from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401


@pytest.mark.asyncio
async def test_capacity_reports_index_size(app_client, tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    wiki_store.index_path().write_text("x" * 1200, encoding="utf-8")
    resp = await app_client.get("/api/knowledge/capacity")
    assert resp.status_code == 200
    b = resp.json()
    assert b["index_chars"] == 1200
    assert b["max_chars"] == 6000
    assert "approx_docs" in b and "entries_done" in b


@pytest.mark.asyncio
async def test_capacity_zero_when_no_index(app_client, tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    resp = await app_client.get("/api/knowledge/capacity")
    assert resp.json()["index_chars"] == 0
