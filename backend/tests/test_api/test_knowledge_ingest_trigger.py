"""Import + reingest should schedule the background ingest runner."""

from __future__ import annotations

import pytest

# Ensure the KnowledgeEntry table is registered on Base.metadata before the
# db_engine fixture runs create_all (import happens at collection time).
from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401


def _record_add_task(monkeypatch):
    """Monkeypatch BackgroundTasks.add_task to capture scheduled calls.

    FastAPI only runs BackgroundTasks after the response is fully sent, which
    the ASGI test transport does not reliably trigger. So instead of asserting
    the runner executed, we assert the route SCHEDULED it.
    """
    from fastapi import BackgroundTasks
    from app.api import knowledge as kmod

    calls = []
    orig = BackgroundTasks.add_task

    def spy(self, func, *args, **kwargs):
        calls.append((func, args, kwargs))
        return orig(self, func, *args, **kwargs)

    monkeypatch.setattr(BackgroundTasks, "add_task", spy)
    return calls, kmod


@pytest.mark.asyncio
async def test_add_knowledge_triggers_ingest(app_client, monkeypatch):
    calls, kmod = _record_add_task(monkeypatch)

    resp = await app_client.post(
        "/api/knowledge",
        json={"feishu_url": "https://x.feishu.cn/docx/Tok123"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ingest_status"] == "pending"
    assert "ingest_error" in body

    ingest_calls = [c for c in calls if c[0] is kmod.ingest_entry]
    assert len(ingest_calls) == 1
    _func, args, kwargs = ingest_calls[0]
    assert args[0] == body["id"]
    # Registries wired from app.state.
    assert "session_factory" in kwargs
    assert "provider_registry" in kwargs
    assert "agent_registry" in kwargs
    assert "tool_registry" in kwargs
    assert "index_manager" in kwargs


@pytest.mark.asyncio
async def test_reingest_resets_status_and_triggers(app_client, monkeypatch):
    # Create an entry first (this also schedules an ingest — we clear calls).
    resp = await app_client.post(
        "/api/knowledge",
        json={"feishu_url": "https://x.feishu.cn/docx/Tok456"},
    )
    assert resp.status_code == 200, resp.text
    entry_id = resp.json()["id"]

    calls, kmod = _record_add_task(monkeypatch)

    r = await app_client.post(f"/api/knowledge/{entry_id}/reingest")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == entry_id
    assert body["ingest_status"] == "pending"
    assert body["ingest_error"] == ""

    ingest_calls = [c for c in calls if c[0] is kmod.ingest_entry]
    assert len(ingest_calls) == 1
    assert ingest_calls[0][1][0] == entry_id


@pytest.mark.asyncio
async def test_reingest_missing_entry_404(app_client):
    r = await app_client.post("/api/knowledge/does-not-exist/reingest")
    assert r.status_code == 404
