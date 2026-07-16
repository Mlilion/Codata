"""Deleting a knowledge entry schedules background LLM cleanup and marks the
row 'deleting' instead of removing it synchronously."""

from __future__ import annotations

import pytest

# Ensure the KnowledgeEntry table is registered on Base.metadata before the
# db_engine fixture runs create_all (import happens at collection time).
from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401
from app.api import knowledge as knowledge_api
from app.models.knowledge_entry import KnowledgeEntry


@pytest.mark.asyncio
async def test_delete_marks_deleting_and_schedules_cleanup(
    app_client, monkeypatch, session_factory
):
    scheduled = []
    monkeypatch.setattr(
        knowledge_api, "_schedule_cleanup",
        lambda request, entry_id: scheduled.append(entry_id),
    )

    async with session_factory() as session:
        async with session.begin():
            session.add(
                KnowledgeEntry(id="e9", feishu_url="u", feishu_token="t", doc_type="docx")
            )

    resp = await app_client.delete("/api/knowledge/e9")
    assert resp.status_code == 200, resp.text
    assert resp.json()["ingest_status"] == "deleting"

    # row is still present (background task will remove it)
    async with session_factory() as session:
        e = await session.get(KnowledgeEntry, "e9")
        assert e is not None
        assert e.ingest_status == "deleting"

    assert scheduled == ["e9"]


@pytest.mark.asyncio
async def test_delete_is_idempotent_while_deleting(
    app_client, monkeypatch, session_factory
):
    scheduled = []
    monkeypatch.setattr(
        knowledge_api, "_schedule_cleanup",
        lambda request, entry_id: scheduled.append(entry_id),
    )

    async with session_factory() as session:
        async with session.begin():
            session.add(
                KnowledgeEntry(
                    id="e10", feishu_url="u", feishu_token="t",
                    doc_type="docx", ingest_status="deleting",
                )
            )

    resp = await app_client.delete("/api/knowledge/e10")
    assert resp.status_code == 200, resp.text
    assert resp.json()["ingest_status"] == "deleting"
    assert scheduled == []   # no re-schedule while already deleting


@pytest.mark.asyncio
async def test_delete_missing_returns_404(app_client):
    resp = await app_client.delete("/api/knowledge/nope")
    assert resp.status_code == 404
