from __future__ import annotations
import io, pytest

# Ensure the KnowledgeEntry table is registered on Base.metadata before the
# db_engine fixture runs create_all (import happens at collection time).
from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401


@pytest.mark.asyncio
async def test_upload_creates_file_entry_and_schedules(app_client, monkeypatch):
    scheduled = {}
    from app.api import knowledge as kmod
    monkeypatch.setattr(kmod, "_schedule_ingest", lambda req, bg, eid: scheduled.setdefault("id", eid))
    files = {"file": ("note.md", io.BytesIO("# hi\n正文".encode()), "text/markdown")}
    resp = await app_client.post("/api/knowledge/upload", files=files)
    assert resp.status_code == 200
    body = resp.json()
    assert body["source_type"] == "file"
    assert body["source_name"] == "note.md"
    assert body["ingest_status"] == "pending"
    assert scheduled.get("id") == body["id"]


@pytest.mark.asyncio
async def test_upload_rejects_unsupported(app_client):
    files = {"file": ("bad.exe", io.BytesIO(b"MZ"), "application/octet-stream")}
    resp = await app_client.post("/api/knowledge/upload", files=files)
    assert resp.status_code == 400
