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

    async def test_layout_persist(self, app_client):
        created = (
            await app_client.post(
                "/api/dashboard/items", json={"title": "a", "payload": SAMPLE_PAYLOAD}
            )
        ).json()
        assert created["layout"] is None
        resp = await app_client.post(
            "/api/dashboard/layout",
            json={"layouts": [{"id": created["id"], "x": 2, "y": 1, "w": 3, "h": 2}]},
        )
        assert resp.status_code == 200
        listed = (await app_client.get("/api/dashboard/items")).json()
        assert listed[0]["layout"] == {"x": 2, "y": 1, "w": 3, "h": 2}

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


@pytest.mark.asyncio
class TestDashboards:
    async def test_list_creates_default(self, app_client):
        resp = await app_client.get("/api/dashboards")
        assert resp.status_code == 200
        boards = resp.json()
        assert len(boards) == 1
        assert boards[0]["is_default"] is True
        assert boards[0]["item_count"] == 0

    async def test_pin_without_target_lands_in_default(self, app_client):
        item = (
            await app_client.post(
                "/api/dashboard/items", json={"title": "x", "payload": SAMPLE_PAYLOAD}
            )
        ).json()
        boards = (await app_client.get("/api/dashboards")).json()
        default = next(b for b in boards if b["is_default"])
        assert item["dashboard_id"] == default["id"]
        assert default["item_count"] == 1

    async def test_create_board_and_scoped_pin(self, app_client):
        board = (
            await app_client.post("/api/dashboards", json={"name": "营收"})
        ).json()
        assert board["is_default"] is False
        assert board["name"] == "营收"

        item = (
            await app_client.post(
                "/api/dashboard/items",
                json={"title": "rev", "payload": SAMPLE_PAYLOAD, "dashboard_id": board["id"]},
            )
        ).json()
        assert item["dashboard_id"] == board["id"]

        # Scoped listing returns only that board's items.
        scoped = (
            await app_client.get(f"/api/dashboard/items?dashboard_id={board['id']}")
        ).json()
        assert [i["id"] for i in scoped] == [item["id"]]
        # The default board has none.
        boards = (await app_client.get("/api/dashboards")).json()
        default = next(b for b in boards if b["is_default"])
        default_items = (
            await app_client.get(f"/api/dashboard/items?dashboard_id={default['id']}")
        ).json()
        assert default_items == []

    async def test_rename_board(self, app_client):
        board = (await app_client.post("/api/dashboards", json={"name": "old"})).json()
        resp = await app_client.patch(
            f"/api/dashboards/{board['id']}", json={"name": "new"}
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "new"

    async def test_delete_board_cascades_items(self, app_client):
        board = (await app_client.post("/api/dashboards", json={"name": "temp"})).json()
        await app_client.post(
            "/api/dashboard/items",
            json={"title": "x", "payload": SAMPLE_PAYLOAD, "dashboard_id": board["id"]},
        )
        resp = await app_client.delete(f"/api/dashboards/{board['id']}")
        assert resp.status_code == 200
        # Its items are gone.
        scoped = (
            await app_client.get(f"/api/dashboard/items?dashboard_id={board['id']}")
        ).json()
        assert scoped == []

    async def test_cannot_delete_last_dashboard(self, app_client):
        boards = (await app_client.get("/api/dashboards")).json()
        assert len(boards) == 1
        resp = await app_client.delete(f"/api/dashboards/{boards[0]['id']}")
        assert resp.status_code == 400

    async def test_delete_default_promotes_another(self, app_client):
        boards = (await app_client.get("/api/dashboards")).json()
        default_id = boards[0]["id"]
        other = (await app_client.post("/api/dashboards", json={"name": "b2"})).json()
        assert other["is_default"] is False
        # Delete the default; the other should be promoted.
        await app_client.delete(f"/api/dashboards/{default_id}")
        after = (await app_client.get("/api/dashboards")).json()
        assert len(after) == 1
        assert after[0]["id"] == other["id"]
        assert after[0]["is_default"] is True
