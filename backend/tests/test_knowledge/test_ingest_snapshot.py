from __future__ import annotations
import pytest
from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry

@pytest.mark.asyncio
async def test_snapshot_raw_writes_file(tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    monkeypatch.setattr(ingest, "find_feishu_client", lambda: object())
    async def fake_read(client, doc_type, token): return "# 正文\n内容"
    monkeypatch.setattr(ingest, "read_feishu_doc", fake_read)
    e = KnowledgeEntry(id="e1", feishu_url="https://x", feishu_token="tok", doc_type="docx")
    rel = await ingest.snapshot_raw(e)
    assert rel == "raw/e1.md"
    assert (wiki_store.raw_dir() / "e1.md").read_text(encoding="utf-8") == "# 正文\n内容"

@pytest.mark.asyncio
async def test_snapshot_raw_no_client(tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    monkeypatch.setattr(ingest, "find_feishu_client", lambda: None)
    e = KnowledgeEntry(id="e2", feishu_url="https://x", feishu_token="tok", doc_type="docx")
    with pytest.raises(RuntimeError):
        await ingest.snapshot_raw(e)
