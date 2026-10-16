from __future__ import annotations
import pytest
from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry

@pytest.mark.asyncio
async def test_snapshot_file_text(tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    src = tmp_path / "note.md"
    src.write_text("# 标题\n正文内容", encoding="utf-8")
    e = KnowledgeEntry(id="f1", source_type="file", file_path=str(src), source_name="note.md")
    rel = await ingest.snapshot_raw(e)
    assert rel == "raw/f1.md"
    assert "正文内容" in (wiki_store.raw_dir() / "f1.md").read_text(encoding="utf-8")

@pytest.mark.asyncio
async def test_snapshot_file_binary_uses_extractor(tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    monkeypatch.setattr(ingest, "is_supported_binary", lambda p: True)
    monkeypatch.setattr(ingest, "extract_document", lambda p: "PDF 提取的文本")
    e = KnowledgeEntry(id="f2", source_type="file", file_path=str(pdf), source_name="doc.pdf")
    rel = await ingest.snapshot_raw(e)
    assert "PDF 提取的文本" in (wiki_store.raw_dir() / "f2.md").read_text(encoding="utf-8")

@pytest.mark.asyncio
async def test_snapshot_file_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    e = KnowledgeEntry(id="f3", source_type="file", file_path=str(tmp_path/"nope.pdf"), source_name="nope.pdf")
    with pytest.raises(RuntimeError):
        await ingest.snapshot_raw(e)
