from __future__ import annotations
import json
import pytest
from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry

@pytest.mark.asyncio
async def test_ingest_passes_through_stages(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    # seed a file-source entry
    async with session_factory() as s:
        s.add(KnowledgeEntry(id="s1", source_type="file",
                             file_path=str(tmp_path / "x.md"), source_name="x.md", title="x.md"))
        await s.commit()
    (tmp_path / "x.md").write_text("内容", encoding="utf-8")

    seen = []
    # record status transitions by patching snapshot_raw + run_generation
    real_get_status = []
    async def fake_snapshot(entry):
        async with session_factory() as s:
            e = await s.get(KnowledgeEntry, "s1"); seen.append(e.ingest_status)
        (wiki_store.raw_dir() / "s1.md").write_text("raw", encoding="utf-8")
        return "raw/s1.md"
    async def fake_run_generation(*a, **k):
        async with session_factory() as s:
            e = await s.get(KnowledgeEntry, "s1"); seen.append(e.ingest_status)
        # simulate agent creating a wiki page
        (wiki_store.wiki_dir() / "concept-x.md").write_text("# X", encoding="utf-8")
    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)

    await ingest.ingest_entry("s1", session_factory=session_factory,
        provider_registry=object(), agent_registry=object(), tool_registry=object())

    assert "extracting" in seen          # snapshot saw 'extracting'
    assert "building" in seen             # run_generation saw 'building'
    async with session_factory() as s:
        e = await s.get(KnowledgeEntry, "s1")
        assert e.ingest_status == "done"
        pages = json.loads(e.wiki_pages or "[]")
        assert "concept-x.md" in pages     # new wiki page recorded
