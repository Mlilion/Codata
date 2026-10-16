from __future__ import annotations

import asyncio

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

    captured = {}

    async def fake_run_generation(job, req, *a, **k):
        captured["session_id"] = req.session_id
        return None

    deleted = []

    async def fake_delete_by_id(db, model, id):
        deleted.append((model, id))
        return True

    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

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

    # the throwaway ingest session must be cleaned up (not left as a phantom chat)
    assert deleted == [(ingest.Session, captured["session_id"])]


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


@pytest.mark.asyncio
async def test_ingest_entry_retries_uncommitted_entry(
    tmp_path, monkeypatch, session_factory
):
    """Row is not visible on the first get (creating txn not yet committed);
    ingest_entry must retry and proceed once the row appears."""
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)

    calls = {"n": 0}

    async def _insert():
        async with session_factory() as s:
            s.add(KnowledgeEntry(id="e3", feishu_url="u", feishu_token="t", doc_type="docx"))
            await s.commit()

    # Wrap the real factory: on the very first call (attempt 0) schedule the
    # row insert. attempt 0's get() runs before the scheduled task, so it sees
    # None; the insert then completes during the 0.2s backoff sleep, so a later
    # attempt finds the committed row. Deterministic: sleep yields long enough
    # for the scheduled coroutine to finish.
    def delayed_factory():
        calls["n"] += 1
        if calls["n"] == 1:
            asyncio.ensure_future(_insert())
        return session_factory()

    async def fake_snapshot(entry):
        return "raw/e3.md"

    async def fake_run_generation(job, req, *a, **k):
        return None

    async def fake_delete_by_id(db, model, id):
        return True

    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await ingest.ingest_entry(
        "e3",
        session_factory=delayed_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    async with session_factory() as s:
        e = await s.get(KnowledgeEntry, "e3")
        assert e is not None
        assert e.ingest_status == "done"
        assert e.raw_path == "raw/e3.md"


@pytest.mark.asyncio
async def test_ingest_entry_gives_up_when_entry_never_exists(
    tmp_path, monkeypatch, session_factory
):
    """When the row never commits, ingest_entry logs-and-returns without raising."""
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)

    # Keep the retry loop fast: no real waiting.
    async def instant_sleep(_):
        return None

    monkeypatch.setattr(ingest.asyncio, "sleep", instant_sleep)

    ran = {"snapshot": False}

    async def fake_snapshot(entry):
        ran["snapshot"] = True
        return "raw/x.md"

    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)

    # Must not raise even though the entry is absent.
    await ingest.ingest_entry(
        "missing",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    # It gave up before doing any ingest work.
    assert ran["snapshot"] is False
