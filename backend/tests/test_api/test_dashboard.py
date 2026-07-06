"""Tests for the dashboard item CRUD endpoints."""

from __future__ import annotations

import pytest

SAMPLE_PAYLOAD = {
    "chartSpec": {
        "chartType": "bar",
        "x": {"field": "channel"},
        "y": [{"field": "dau"}],
        "title": "DAU by channel",
    },
    "sqlResult": {
        "sql": "SELECT channel, dau FROM t",
        "columns": [{"name": "channel"}, {"name": "dau"}],
        "rows": [["App", 12304], ["Web", 8021]],
        "rowCount": 2,
        "truncated": False,
    },
}


@pytest.mark.asyncio
class TestDashboardItems:
    async def test_list_empty(self, app_client):
        resp = await app_client.get("/api/dashboard/items")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_and_roundtrip_payload(self, app_client):
        resp = await app_client.post(
            "/api/dashboard/items",
            json={"title": "DAU", "payload": SAMPLE_PAYLOAD},
        )
        assert resp.status_code == 200
        item = resp.json()
        assert item["title"] == "DAU"
        assert item["id"]
        assert item["position"] == 1
        # payload survives the JSON column round-trip unchanged
        assert item["payload"] == SAMPLE_PAYLOAD

        listed = (await app_client.get("/api/dashboard/items")).json()
        assert len(listed) == 1
        assert listed[0]["id"] == item["id"]
        assert listed[0]["payload"]["chartSpec"]["chartType"] == "bar"

    async def test_position_increments(self, app_client):
        first = (
            await app_client.post(
                "/api/dashboard/items", json={"title": "a", "payload": SAMPLE_PAYLOAD}
            )
        ).json()
        second = (
            await app_client.post(
                "/api/dashboard/items", json={"title": "b", "payload": SAMPLE_PAYLOAD}
            )
        ).json()
        assert second["position"] == first["position"] + 1

        listed = (await app_client.get("/api/dashboard/items")).json()
        # ordered by position ascending
        assert [i["title"] for i in listed] == ["a", "b"]

    async def test_rename(self, app_client):
        created = (
            await app_client.post(
                "/api/dashboard/items", json={"title": "old", "payload": SAMPLE_PAYLOAD}
            )
        ).json()
        resp = await app_client.patch(
            f"/api/dashboard/items/{created['id']}", json={"title": "new"}
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "new"

    async def test_rename_missing_404(self, app_client):
        resp = await app_client.patch(
            "/api/dashboard/items/does-not-exist", json={"title": "x"}
        )
        assert resp.status_code == 404

    async def test_delete_is_idempotent(self, app_client):
        created = (
            await app_client.post(
                "/api/dashboard/items", json={"title": "x", "payload": SAMPLE_PAYLOAD}
            )
        ).json()
        r1 = await app_client.delete(f"/api/dashboard/items/{created['id']}")
        assert r1.status_code == 200 and r1.json()["success"] is True
        # second delete still succeeds
        r2 = await app_client.delete(f"/api/dashboard/items/{created['id']}")
        assert r2.status_code == 200 and r2.json()["success"] is True
        assert (await app_client.get("/api/dashboard/items")).json() == []

    async def test_reorder(self, app_client):
        a = (
            await app_client.post(
                "/api/dashboard/items", json={"title": "a", "payload": SAMPLE_PAYLOAD}
            )
        ).json()
        b = (
            await app_client.post(
                "/api/dashboard/items", json={"title": "b", "payload": SAMPLE_PAYLOAD}
            )
        ).json()
        # reverse the order
        resp = await app_client.post(
            "/api/dashboard/reorder", json={"ordered_ids": [b["id"], a["id"]]}
        )
        assert resp.status_code == 200
        listed = (await app_client.get("/api/dashboard/items")).json()
        assert [i["title"] for i in listed] == ["b", "a"]
