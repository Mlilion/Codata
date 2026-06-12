"""Tests for ViMax task control endpoints."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.message import Part
from app.models.vimax_task_run import ViMaxTaskRun
from app.session.manager import create_message, create_part, create_session
from app.streaming.manager import GenerationJob
from app.tool.base import ToolResult

pytestmark = pytest.mark.asyncio


async def test_resume_task_marks_existing_tool_part_running(app_client, session_factory):
    async with session_factory() as db:
        async with db.begin():
            session = await create_session(db, title="Video")
            message = await create_message(
                db,
                session_id=session.id,
                data={"role": "assistant", "mode": "expert-team"},
            )
            part = await create_part(
                db,
                message_id=message.id,
                session_id=session.id,
                data={
                    "type": "tool",
                    "tool": "vimax_generate_video",
                    "call_id": "call-1",
                    "state": {
                        "status": "error",
                        "input": {
                            "mode": "script2video",
                            "script": "INT. TEST - DAY",
                            "wait": False,
                        },
                        "output": "failed",
                        "metadata": {"task_id": "task-1"},
                        "title": "ViMax failed: task-1",
                        "time_start": None,
                        "time_end": None,
                        "time_compacted": None,
                    },
                },
            )
            db.add(
                ViMaxTaskRun(
                    session_id=session.id,
                    message_id=message.id,
                    call_id="call-1",
                    task_id="task-1",
                    tool_id="vimax_generate_video",
                    mode="script2video",
                    status="failed",
                    stage="failed",
                    input_payload={"mode": "script2video", "script": "INT. TEST - DAY", "wait": False},
                    runtime_status={
                        "task_id": "task-1",
                        "status": "failed",
                        "workcraft_context": {"provider_id": "openrouter", "model_id": "google/gemini-test"},
                    },
                )
            )
            session_id = session.id
            part_id = part.id

    resp = await app_client.post(
        "/api/vimax/tasks/task-1/resume",
        json={"session_id": session_id},
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["task_id"] == "task-1"
    assert payload["session_id"] == session_id
    assert payload["stream_id"]

    async with session_factory() as db:
        result = await db.execute(select(Part).where(Part.id == part_id))
        updated = result.scalar_one()
        state = updated.data["state"]
        assert state["status"] == "running"
        assert state["metadata"]["task_id"] == "task-1"
        assert state["metadata"]["retrying"] is True


async def test_resume_task_rejects_wrong_session(app_client, session_factory):
    async with session_factory() as db:
        async with db.begin():
            session = await create_session(db, title="Video")
            other = await create_session(db, title="Other")
            message = await create_message(db, session_id=session.id, data={"role": "assistant"})
            await create_part(
                db,
                message_id=message.id,
                session_id=session.id,
                data={
                    "type": "tool",
                    "tool": "vimax_generate_video",
                    "call_id": "call-1",
                    "state": {"status": "error", "input": {"script": "x"}, "metadata": {"task_id": "task-1"}},
                },
            )
            db.add(
                ViMaxTaskRun(
                    session_id=session.id,
                    message_id=message.id,
                    call_id="call-1",
                    task_id="task-1",
                    tool_id="vimax_generate_video",
                    mode="script2video",
                    status="failed",
                    stage="failed",
                    input_payload={},
                    runtime_status={},
                )
            )
            other_id = other.id

    resp = await app_client.post(
        "/api/vimax/tasks/task-1/resume",
        json={"session_id": other_id},
    )

    assert resp.status_code == 400


async def test_persist_resume_result_appends_completed_expert_step(session_factory, tmp_path):
    from app.api.vimax import _persist_resume_result

    final_video = tmp_path / "final_video.mp4"
    final_video.write_bytes(b"video")

    async with session_factory() as db:
        async with db.begin():
            session = await create_session(db, title="Video")
            message = await create_message(
                db,
                session_id=session.id,
                data={"role": "assistant", "mode": "expert-team"},
            )
            await create_part(
                db,
                message_id=message.id,
                session_id=session.id,
                data={
                    "type": "step-start",
                    "snapshot": {
                        "step": 2,
                        "title": "渲染执行: 视频渲染",
                        "mode": "expert-team",
                        "member_id": "producer",
                        "member_name": "渲染执行",
                        "member_role": "视频渲染",
                        "task_id": "render",
                        "task_name": "视频渲染",
                        "status": "running",
                    },
                },
            )
            tool_part = await create_part(
                db,
                message_id=message.id,
                session_id=session.id,
                data={
                    "type": "tool",
                    "tool": "vimax_generate_video",
                    "call_id": "call-1",
                    "state": {
                        "status": "error",
                        "input": {"mode": "script2video", "script": "INT. TEST - DAY", "wait": True},
                        "output": "failed",
                        "metadata": {"task_id": "task-1"},
                        "title": "ViMax failed: task-1",
                        "time_start": None,
                        "time_end": None,
                        "time_compacted": None,
                    },
                },
            )
            await create_part(
                db,
                message_id=message.id,
                session_id=session.id,
                data={
                    "type": "step-finish",
                    "reason": "error",
                    "tokens": {},
                    "cost": 0.0,
                    "snapshot": {
                        "step": 2,
                        "title": "渲染执行: 视频渲染",
                        "mode": "expert-team",
                        "member_id": "producer",
                        "member_name": "渲染执行",
                        "member_role": "视频渲染",
                        "task_id": "render",
                        "task_name": "视频渲染",
                        "status": "failed",
                        "reason": "old failed log",
                    },
                },
            )
            session_id = session.id
            message_id = message.id
            part_id = tool_part.id

    job = GenerationJob(stream_id="stream-1", session_id=session_id)
    result = ToolResult(
        output="ViMax task finished.",
        title="ViMax video: task-1",
        metadata={
            "task_id": "task-1",
            "status": "completed",
            "stage": "completed",
            "message": "Video generation completed",
            "final_video_path": str(final_video),
            "file_path": str(final_video),
        },
        attachments=[
            {
                "file_id": "file-1",
                "name": "final_video.mp4",
                "path": str(final_video),
                "size": final_video.stat().st_size,
                "mime_type": "video/mp4",
                "source": "referenced",
                "vimax_role": "final_video",
                "vimax_kind": "video",
                "relative_path": "final_video.mp4",
            }
        ],
    )

    snapshot = await _persist_resume_result(
        session_factory,
        job,
        message_id=message_id,
        part_id=part_id,
        call_id="call-1",
        task_id="task-1",
        result=result,
    )

    assert snapshot is not None
    assert snapshot["status"] == "completed"
    assert snapshot["reason"] == "Video generation completed"
    assert str(final_video) in snapshot["result_preview"]

    async with session_factory() as db:
        tool = await db.get(Part, part_id)
        assert tool is not None
        assert tool.data["state"]["status"] == "completed"

        parts = (
            await db.execute(
                select(Part)
                .where(Part.message_id == message_id)
                .where(Part.data["type"].as_string() == "step-finish")
                .order_by(Part.time_created.asc(), Part.id.asc())
            )
        ).scalars().all()
        assert [item.data["snapshot"]["status"] for item in parts] == ["failed", "completed"]
