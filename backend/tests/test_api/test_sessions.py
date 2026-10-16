"""Tests for session CRUD API endpoints."""

from __future__ import annotations

import pytest

from app.models.todo import Todo
from app.session.manager import create_session

pytestmark = pytest.mark.asyncio


class TestListSessions:
    async def test_empty(self, app_client):
        resp = await app_client.get("/api/sessions")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_created(self, app_client):
        await app_client.post("/api/sessions", json={"title": "First"})
        await app_client.post("/api/sessions", json={"title": "Second"})
        resp = await app_client.get("/api/sessions")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    async def test_pagination(self, app_client):
        for i in range(5):
            await app_client.post("/api/sessions", json={"title": f"S{i}"})
        resp = await app_client.get("/api/sessions", params={"limit": 2, "offset": 0})
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    async def test_project_id_filter(self, app_client):
        await app_client.post("/api/sessions", json={"title": "A", "project_id": "p1"})
        await app_client.post("/api/sessions", json={"title": "B", "project_id": "p2"})
        resp = await app_client.get("/api/sessions", params={"project_id": "p1"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["project_id"] == "p1"


class TestCreateSession:
    async def test_success(self, app_client):
        resp = await app_client.post("/api/sessions", json={"title": "Test"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Test"
        assert "id" in data

    async def test_defaults(self, app_client):
        resp = await app_client.post("/api/sessions", json={})
        assert resp.status_code == 201
        assert resp.json()["title"] == "New Session"

    async def test_with_directory(self, app_client):
        resp = await app_client.post(
            "/api/sessions",
            json={"title": "X", "project_id": "proj", "directory": "/tmp/test"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["project_id"] == "proj"
        assert data["directory"] == "/tmp/test"


class TestGetSession:
    async def test_existing(self, app_client):
        create = await app_client.post("/api/sessions", json={"title": "Get me"})
        sid = create.json()["id"]
        resp = await app_client.get(f"/api/sessions/{sid}")
        assert resp.status_code == 200
        assert resp.json()["title"] == "Get me"

    async def test_not_found(self, app_client):
        resp = await app_client.get("/api/sessions/nonexistent")
        assert resp.status_code == 404


class TestSessionHasCompaction:
    """``has_compaction`` lets the frontend context indicator show the
    "compacted" state even when auto-compaction summary messages are hidden
    from the display feed (role=user + system)."""

    async def test_false_by_default(self, app_client):
        create = await app_client.post("/api/sessions", json={"title": "No compaction"})
        sid = create.json()["id"]
        resp = await app_client.get(f"/api/sessions/{sid}")
        assert resp.status_code == 200
        assert resp.json()["has_compaction"] is False

    async def test_true_when_compaction_part_exists(self, app_client, session_factory):
        from app.models.message import Message, Part

        create = await app_client.post("/api/sessions", json={"title": "Compacted"})
        sid = create.json()["id"]
        async with session_factory() as db:
            async with db.begin():
                msg = Message(session_id=sid, data={"role": "user", "system": True})
                db.add(msg)
                await db.flush()
                db.add(
                    Part(
                        message_id=msg.id,
                        session_id=sid,
                        data={"type": "compaction", "auto": True},
                    )
                )

        detail = await app_client.get(f"/api/sessions/{sid}")
        assert detail.json()["has_compaction"] is True

        listing = await app_client.get("/api/sessions")
        entry = next(s for s in listing.json() if s["id"] == sid)
        assert entry["has_compaction"] is True


class TestUpdateSession:
    async def test_update_title(self, app_client):
        create = await app_client.post("/api/sessions", json={"title": "Old"})
        sid = create.json()["id"]
        resp = await app_client.patch(f"/api/sessions/{sid}", json={"title": "New"})
        assert resp.status_code == 200
        assert resp.json()["title"] == "New"

    async def test_not_found(self, app_client):
        resp = await app_client.patch("/api/sessions/nope", json={"title": "X"})
        assert resp.status_code == 404

    async def test_update_directory(self, app_client):
        create = await app_client.post("/api/sessions", json={})
        sid = create.json()["id"]
        resp = await app_client.patch(f"/api/sessions/{sid}", json={"directory": "/new"})
        assert resp.status_code == 200
        assert resp.json()["directory"] == "/new"


class TestDeleteSession:
    async def test_success(self, app_client):
        create = await app_client.post("/api/sessions", json={"title": "Del"})
        sid = create.json()["id"]
        resp = await app_client.delete(f"/api/sessions/{sid}")
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True
        assert (await app_client.get(f"/api/sessions/{sid}")).status_code == 404

    async def test_not_found(self, app_client):
        resp = await app_client.delete("/api/sessions/nonexistent")
        assert resp.status_code == 404


class TestSessionTodos:
    async def test_in_progress_todos_are_inactive_when_no_generation_is_running(
        self,
        app_client,
        session_factory,
    ):
        async with session_factory() as db:
            async with db.begin():
                session = await create_session(db, title="Todos")
                sid = session.id
                db.add_all(
                    [
                        Todo(
                            session_id=sid,
                            content="Generate pages",
                            status="in_progress",
                            active_form="Generating pages",
                            position=0,
                        ),
                        Todo(
                            session_id=sid,
                            content="Update index",
                            status="pending",
                            active_form="Updating index",
                            position=1,
                        ),
                    ]
                )

        resp = await app_client.get(f"/api/sessions/{sid}/todos")

        assert resp.status_code == 200
        todos = resp.json()["todos"]
        assert todos[0]["status"] == "pending"
        assert todos[0]["activeForm"] == ""
        assert todos[1]["status"] == "pending"


class TestSearchSessions:
    async def test_empty_query(self, app_client):
        resp = await app_client.get("/api/sessions/search", params={"q": ""})
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_by_title(self, app_client):
        await app_client.post("/api/sessions", json={"title": "Python tutorial"})
        await app_client.post("/api/sessions", json={"title": "Rust guide"})
        resp = await app_client.get("/api/sessions/search", params={"q": "Python"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) >= 1

    async def test_app_mode_filter(self, app_client, session_factory):
        async with session_factory() as db:
            async with db.begin():
                await create_session(db, title="Scoped needle chat", app_mode=None)
                await create_session(db, title="Scoped needle codata", app_mode="codata")

        chat_resp = await app_client.get(
            "/api/sessions/search",
            params={"q": "Scoped needle", "app_mode": "chat"},
        )
        codata_resp = await app_client.get(
            "/api/sessions/search",
            params={"q": "Scoped needle", "app_mode": "codata"},
        )

        assert chat_resp.status_code == 200
        assert [item["session"]["title"] for item in chat_resp.json()] == [
            "Scoped needle chat"
        ]
        assert codata_resp.status_code == 200
        assert [item["session"]["title"] for item in codata_resp.json()] == [
            "Scoped needle codata"
        ]
