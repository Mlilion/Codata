"""Tests for the dashboard item CRUD endpoints."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest


class _FakeTool:
    def __init__(self, name: str):
        self.name = name


class _FakeContentItem:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class _FakeCallResult:
    def __init__(self, text: str, is_error: bool = False):
        self.content = [_FakeContentItem(text)]
        self.isError = is_error


class _FakeClient:
    """Minimal stand-in for McpClient exposing execute_sql."""

    def __init__(self, rows, columns, *, connected=True, raise_err=False):
        self.status = "connected" if connected else "failed"
        self._rows = rows
        self._columns = columns
        self._raise = raise_err

    def list_tools(self):
        return [_FakeTool("execute_sql"), _FakeTool("list_tables")]

    async def call_tool(self, name, args):
        if self._raise:
            raise RuntimeError("boom")
        return _FakeCallResult(
            json.dumps({
                "mode": "sync",
                "columns": self._columns,
                "data": self._rows,
                "row_count": len(self._rows),
                "truncated": False,
            })
        )


class _FakeManager:
    def __init__(self, client):
        self._clients = {"datasage": client} if client else {}


def _install_manager(app_client, client):
    """Attach a fake MCP manager to the app so _rerun_sql can find it."""
    app_client.app.state.connector_registry = None
    app_client.app.state.mcp_manager = _FakeManager(client)


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


@pytest.mark.asyncio
class TestDashboardRefresh:
    async def _pin(self, app_client):
        return (
            await app_client.post(
                "/api/dashboard/items", json={"title": "x", "payload": SAMPLE_PAYLOAD}
            )
        ).json()

    async def test_refresh_updates_snapshot(self, app_client):
        item = await self._pin(app_client)
        assert item["refreshed_at"] is None

        # Fake data source returns new rows for the same SQL.
        _install_manager(
            app_client,
            _FakeClient(
                rows=[["App", 20000], ["Web", 9000], ["H5", 5000]],
                columns=["channel", "dau"],
            ),
        )
        resp = await app_client.post(f"/api/dashboard/items/{item['id']}/refresh")
        assert resp.status_code == 200
        body = resp.json()
        # Data updated, sql + chartSpec preserved, refreshed_at stamped.
        assert body["payload"]["sqlResult"]["rows"] == [
            ["App", 20000], ["Web", 9000], ["H5", 5000],
        ]
        assert body["payload"]["sqlResult"]["rowCount"] == 3
        assert body["payload"]["sqlResult"]["sql"] == SAMPLE_PAYLOAD["sqlResult"]["sql"]
        assert body["payload"]["chartSpec"]["chartType"] == "bar"
        assert body["refreshed_at"] is not None

        # Persisted.
        listed = (await app_client.get("/api/dashboard/items")).json()
        assert listed[0]["payload"]["sqlResult"]["rowCount"] == 3

    async def test_refresh_no_datasource_keeps_snapshot(self, app_client):
        item = await self._pin(app_client)
        _install_manager(app_client, None)  # no connected execute_sql client
        resp = await app_client.post(f"/api/dashboard/items/{item['id']}/refresh")
        assert resp.status_code == 502
        # Snapshot untouched.
        listed = (await app_client.get("/api/dashboard/items")).json()
        assert listed[0]["payload"]["sqlResult"]["rows"] == SAMPLE_PAYLOAD["sqlResult"]["rows"]
        assert listed[0]["refreshed_at"] is None

    async def test_refresh_query_error_keeps_snapshot(self, app_client):
        item = await self._pin(app_client)
        _install_manager(app_client, _FakeClient(rows=[], columns=[], raise_err=True))
        resp = await app_client.post(f"/api/dashboard/items/{item['id']}/refresh")
        assert resp.status_code == 502
        listed = (await app_client.get("/api/dashboard/items")).json()
        assert listed[0]["payload"]["sqlResult"]["rows"] == SAMPLE_PAYLOAD["sqlResult"]["rows"]

    async def test_refresh_item_without_sql_400(self, app_client):
        no_sql = {"chartSpec": SAMPLE_PAYLOAD["chartSpec"], "sqlResult": {"columns": [], "rows": []}}
        item = (
            await app_client.post(
                "/api/dashboard/items", json={"title": "n", "payload": no_sql}
            )
        ).json()
        _install_manager(app_client, _FakeClient(rows=[["a", 1]], columns=["k", "v"]))
        resp = await app_client.post(f"/api/dashboard/items/{item['id']}/refresh")
        assert resp.status_code == 400

    async def test_refresh_missing_item_404(self, app_client):
        _install_manager(app_client, _FakeClient(rows=[["a", 1]], columns=["k", "v"]))
        resp = await app_client.post("/api/dashboard/items/nope/refresh")
        assert resp.status_code == 404
