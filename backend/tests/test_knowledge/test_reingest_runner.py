from __future__ import annotations

import json

import pytest

from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry


@pytest.mark.asyncio
async def test_reingest_cleans_then_reingests_keeping_row_and_raw(
    tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    raw = wiki_store.raw_dir() / "r1.md"
    raw.write_text("old", encoding="utf-8")
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="r1", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="pending", raw_path="raw/r1.md",
            wiki_pages=json.dumps(["source-r1.md"]),
        ))
        await s.commit()

    phases = []

    def fake_cleanup_prompt(entry, source_page, wiki_dir):
        return "CLEANUP"

    def fake_ingest_prompt(entry, raw_rel, wiki_dir):
        return "INGEST"

    async def fake_run_generation(job, req, *a, **k):
        phases.append("cleanup" if req.text == "CLEANUP" else "ingest")
        return None

    async def fake_snapshot(entry):
        return "raw/r1.md"

    async def fake_delete_by_id(db, model, id):
        return True

    monkeypatch.setattr(ingest, "build_cleanup_prompt", fake_cleanup_prompt)
    monkeypatch.setattr(ingest, "build_ingest_prompt", fake_ingest_prompt)
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await ingest.reingest_entry(
        "r1",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    # clean THEN build
    assert phases == ["cleanup", "ingest"]
    # row preserved and marked done; raw preserved (re-snapshotted)
    async with session_factory() as s:
        e = await s.get(KnowledgeEntry, "r1")
        assert e is not None
        assert e.ingest_status == "done"
    assert raw.exists()


@pytest.mark.asyncio
async def test_reingest_without_source_skips_cleanup(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="r2", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="pending", raw_path="", wiki_pages=json.dumps([]),
        ))
        await s.commit()

    phases = []

    async def fake_run_generation(job, req, *a, **k):
        phases.append(req.text)
        return None

    async def fake_snapshot(entry):
        return "raw/r2.md"

    monkeypatch.setattr(ingest, "build_cleanup_prompt", lambda *a: "CLEANUP")
    monkeypatch.setattr(ingest, "build_ingest_prompt", lambda *a: "INGEST")
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "delete_by_id", lambda *a, **k: _true())

    await ingest.reingest_entry(
        "r2",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    assert phases == ["INGEST"]   # no cleanup phase (no source page)


async def _true():
    return True
