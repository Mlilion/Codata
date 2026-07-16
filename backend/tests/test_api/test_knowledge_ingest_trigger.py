"""Import + reingest should schedule the background ingest runner."""

from __future__ import annotations

import pytest

# Ensure the KnowledgeEntry table is registered on Base.metadata before the
# db_engine fixture runs create_all (import happens at collection time).
from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401


def _record_schedule(monkeypatch):
    """Monkeypatch _schedule_ingest to capture scheduled calls.

    The route commits the entry in its own session then fires the ingest via
    asyncio.create_task. The ASGI test transport does not reliably run that
    task, so instead of asserting the runner executed, we assert the route
    SCHEDULED it with the created id.
    """
    from app.api import knowledge as kmod

    calls = []
    monkeypatch.setattr(
        kmod,
        "_schedule_ingest",
        lambda request, entry_id: calls.append(entry_id),
    )
    return calls, kmod


@pytest.mark.asyncio
async def test_add_knowledge_triggers_ingest(app_client, monkeypatch):
    calls, kmod = _record_schedule(monkeypatch)

    resp = await app_client.post(
        "/api/knowledge",
        json={"feishu_url": "https://x.feishu.cn/docx/Tok123"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ingest_status"] == "pending"
    assert "ingest_error" in body

    assert calls == [body["id"]]


@pytest.mark.asyncio
async def test_reingest_resets_status_and_triggers(app_client, monkeypatch):
    # Stub scheduling from the start so the setup entry's ingest never runs
    # for real (asyncio.create_task fires eagerly) and can't race the reingest.
    calls, kmod = _record_schedule(monkeypatch)

    # Create an entry first (this also schedules an ingest — we clear calls).
    resp = await app_client.post(
        "/api/knowledge",
        json={"feishu_url": "https://x.feishu.cn/docx/Tok456"},
    )
    assert resp.status_code == 200, resp.text
    entry_id = resp.json()["id"]

    calls.clear()

    r = await app_client.post(f"/api/knowledge/{entry_id}/reingest")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == entry_id
    assert body["ingest_status"] == "pending"
    assert body["ingest_error"] == ""

    assert calls == [entry_id]


@pytest.mark.asyncio
async def test_reingest_missing_entry_404(app_client):
    r = await app_client.post("/api/knowledge/does-not-exist/reingest")
    assert r.status_code == 404
