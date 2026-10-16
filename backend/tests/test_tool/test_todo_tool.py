"""Tests for app.tool.builtin.todo — TodoTool._build_result()."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.todo import Todo
from app.session.manager import create_session
from app.tool.builtin.todo import (
    TodoTool,
    clear_in_progress_todos,
    mark_in_progress_todos_inactive,
)


class TestBuildResult:
    def test_summary_counts(self):
        todos = [
            {"content": "A", "status": "completed"},
            {"content": "B", "status": "in_progress"},
            {"content": "C", "status": "pending"},
        ]
        result = TodoTool._build_result(todos)
        assert "1/3 done" in result.output
        assert "1 in progress" in result.output
        assert "1 pending" in result.output

    def test_all_completed(self):
        todos = [
            {"content": "A", "status": "completed"},
            {"content": "B", "status": "completed"},
        ]
        result = TodoTool._build_result(todos)
        assert "2/2 done" in result.output
        assert "pending" not in result.output

    def test_empty_list(self):
        result = TodoTool._build_result([])
        assert "0/0 done" in result.output


def test_mark_in_progress_todos_inactive():
    todos = [
        {"content": "A", "status": "completed", "activeForm": "A"},
        {"content": "B", "status": "in_progress", "activeForm": "Doing B"},
        {"content": "C", "status": "pending", "activeForm": "C"},
    ]

    result = mark_in_progress_todos_inactive(todos)

    assert result[0]["status"] == "completed"
    assert result[1]["status"] == "pending"
    assert result[1]["activeForm"] == ""
    assert result[2]["status"] == "pending"


@pytest.mark.asyncio
async def test_clear_in_progress_todos_persists_pending_status(session_factory):
    async with session_factory() as db:
        async with db.begin():
            session = await create_session(db, title="todos")
            sid = session.id
            db.add_all(
                [
                    Todo(
                        session_id=sid,
                        content="A",
                        status="completed",
                        active_form="A",
                        position=0,
                    ),
                    Todo(
                        session_id=sid,
                        content="B",
                        status="in_progress",
                        active_form="Doing B",
                        position=1,
                    ),
                ]
            )

    changed = await clear_in_progress_todos(sid, session_factory)

    async with session_factory() as db:
        rows = (
            await db.execute(
                select(Todo)
                .where(Todo.session_id == sid)
                .order_by(Todo.position)
            )
        ).scalars().all()

    assert changed == 1
    assert rows[0].status == "completed"
    assert rows[1].status == "pending"
    assert rows[1].active_form == ""
