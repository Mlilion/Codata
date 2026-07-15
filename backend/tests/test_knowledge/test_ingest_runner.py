from __future__ import annotations

import pytest

from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry


@pytest.mark.asyncio
async def test_ingest_entry_success(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    async with session_factory() as s:
        s.add(KnowledgeEntry(id="e1", feishu_url="u", feishu_token="t", doc_type="docx"))
        await s.commit()

    async def fake_snapshot(entry):
        return "raw/e1.md"

    async def fake_run_generation(*a, **k):
        return None

    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)

    await ingest.ingest_entry(
        "e1",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    async with session_factory() as s:
        e = await s.get(KnowledgeEntry, "e1")
        assert e.ingest_status == "done"
        assert e.raw_path == "raw/e1.md"


@pytest.mark.asyncio
async def test_ingest_entry_failure_sets_failed(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    async with session_factory() as s:
        s.add(KnowledgeEntry(id="e2", feishu_url="u", feishu_token="t", doc_type="docx"))
        await s.commit()

    async def boom(entry):
        raise RuntimeError("飞书未连接")

    monkeypatch.setattr(ingest, "snapshot_raw", boom)

    await ingest.ingest_entry(
        "e2",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    async with session_factory() as s:
        e = await s.get(KnowledgeEntry, "e2")
        assert e.ingest_status == "failed"
        assert "飞书未连接" in e.ingest_error
