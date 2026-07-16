"""Tests for the knowledge base CRUD endpoints."""

from __future__ import annotations

import pytest

# Ensure the KnowledgeEntry table is registered on Base.metadata before the
# db_engine fixture runs create_all (import happens at collection time).
from app.models import knowledge_entry as _knowledge_entry_models  # noqa: F401


@pytest.mark.asyncio
class TestKnowledgeCRUD:
    async def test_add_and_list_knowledge(self, app_client):
        r = await app_client.post(
            "/api/knowledge",
            json={"feishu_url": "https://x.feishu.cn/docx/Tok123", "note": "口径说明"},
        )
        assert r.status_code == 200, r.text
        entry = r.json()
        assert entry["doc_type"] == "docx"
        assert entry["feishu_token"] == "Tok123"
        assert entry["note"] == "口径说明"

        r2 = await app_client.get("/api/knowledge")
        assert r2.status_code == 200
        ids = [e["id"] for e in r2.json()["entries"]]
        assert entry["id"] in ids

    async def test_add_rejects_bad_url(self, app_client):
        r = await app_client.post(
            "/api/knowledge", json={"feishu_url": "https://example.com/x"}
        )
        assert r.status_code == 400

    async def test_patch_and_delete(self, app_client, monkeypatch):
        from app.api import knowledge as knowledge_api

        monkeypatch.setattr(
            knowledge_api, "_schedule_cleanup", lambda request, entry_id: None
        )
        r = await app_client.post(
            "/api/knowledge", json={"feishu_url": "https://x.feishu.cn/wiki/W1"}
        )
        eid = r.json()["id"]

        rp = await app_client.patch(
            f"/api/knowledge/{eid}", json={"enabled": False, "note": "n2"}
        )
        assert rp.status_code == 200
        assert rp.json()["enabled"] is False
        assert rp.json()["note"] == "n2"

        # Delete now schedules async cleanup and marks the row 'deleting'
        # instead of removing it synchronously.
        rd = await app_client.delete(f"/api/knowledge/{eid}")
        assert rd.status_code == 200
        assert rd.json()["ingest_status"] == "deleting"

        # Row is still present until the background task removes it.
        rp2 = await app_client.patch(f"/api/knowledge/{eid}", json={"note": "x"})
        assert rp2.status_code == 200
