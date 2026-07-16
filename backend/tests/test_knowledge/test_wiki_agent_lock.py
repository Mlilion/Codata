from __future__ import annotations

import asyncio
import json

import pytest

from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry


@pytest.mark.asyncio
async def test_concurrent_cleanups_do_not_overlap(tmp_path, monkeypatch, session_factory):
    """Two cleanup_entry tasks must serialize their wiki-agent section:
    the second must not enter run_generation until the first has left it."""
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    for eid in ("k1", "k2"):
        (wiki_store.raw_dir() / f"{eid}.md").write_text("x", encoding="utf-8")
        async with session_factory() as s:
            s.add(KnowledgeEntry(
                id=eid, feishu_url="u", feishu_token="t", doc_type="docx",
                ingest_status="deleting", raw_path=f"raw/{eid}.md",
                wiki_pages=json.dumps([f"source-{eid}.md"]),
            ))
            await s.commit()

    active = 0
    max_active = 0

    async def fake_run_generation(job, req, *a, **k):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.05)   # hold the "wiki write" window open
        active -= 1
        return None

    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)

    async def fake_delete_by_id(db, model, id):
        return True

    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await asyncio.gather(
        ingest.cleanup_entry("k1", session_factory=session_factory,
                             provider_registry=object(), agent_registry=object(),
                             tool_registry=object()),
        ingest.cleanup_entry("k2", session_factory=session_factory,
                             provider_registry=object(), agent_registry=object(),
                             tool_registry=object()),
    )

    assert max_active == 1, f"wiki-agent section ran concurrently (max_active={max_active})"
