from __future__ import annotations
import pytest
from app.knowledge import wiki_store

# Ensure the KnowledgeEntry table is registered on Base.metadata before the
# db_engine fixture runs create_all (import happens at collection time).
from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401


@pytest.mark.asyncio
async def test_read_wiki_page_returns_content(app_client, tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    (wiki_store.wiki_dir() / "concept-x.md").write_text(
        "# Concept X\n\nhello wiki", encoding="utf-8"
    )
    resp = await app_client.get("/api/knowledge/wiki?page=concept-x.md")
    assert resp.status_code == 200
    b = resp.json()
    assert b["page"] == "concept-x.md"
    assert b["content"] == "# Concept X\n\nhello wiki"


@pytest.mark.asyncio
async def test_read_wiki_page_no_extension_falls_back_to_md(
    app_client, tmp_path, monkeypatch
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    (wiki_store.wiki_dir() / "concept-x.md").write_text(
        "# Concept X\n\nhello wiki", encoding="utf-8"
    )
    resp = await app_client.get("/api/knowledge/wiki?page=concept-x")
    assert resp.status_code == 200
    b = resp.json()
    assert b["page"] == "concept-x.md"
    assert b["content"] == "# Concept X\n\nhello wiki"


@pytest.mark.asyncio
async def test_read_wiki_page_blocks_traversal(app_client, tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    wiki_store.wiki_dir()  # ensure dirs exist
    resp = await app_client.get("/api/knowledge/wiki?page=../../etc/passwd")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_read_wiki_page_missing_returns_404(app_client, tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    wiki_store.wiki_dir()  # ensure dirs exist
    resp = await app_client.get("/api/knowledge/wiki?page=nope.md")
    assert resp.status_code == 404
