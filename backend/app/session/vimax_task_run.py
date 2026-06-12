"""Persistent helpers for ViMax task association and resume lookup."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vimax_task_run import ViMaxTaskRun
from app.storage.repository import create

_SECRET_KEY_PARTS = ("api_key", "apikey", "secret", "token", "password", "authorization")


async def get_vimax_task_run(db: AsyncSession, task_id: str) -> ViMaxTaskRun | None:
    """Load a ViMax task by runtime task id."""
    result = await db.execute(select(ViMaxTaskRun).where(ViMaxTaskRun.task_id == task_id))
    return result.scalar_one_or_none()


async def get_latest_vimax_task_run_for_session(
    db: AsyncSession,
    session_id: str,
) -> ViMaxTaskRun | None:
    """Load the most recently updated ViMax task for a session."""
    result = await db.execute(
        select(ViMaxTaskRun)
        .where(ViMaxTaskRun.session_id == session_id)
        .order_by(ViMaxTaskRun.time_created.desc(), ViMaxTaskRun.time_updated.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def upsert_vimax_task_run(
    db: AsyncSession,
    *,
    session_id: str,
    message_id: str,
    call_id: str,
    task_id: str,
    tool_id: str,
    mode: str,
    status: str,
    stage: str,
    working_dir: str = "",
    final_video_path: str | None = None,
    error_message: str | None = None,
    input_payload: dict[str, Any] | None = None,
    runtime_status: dict[str, Any] | None = None,
) -> ViMaxTaskRun:
    """Create or update the persistent record for a ViMax task."""
    record = await get_vimax_task_run(db, task_id)
    if record is None:
        record = ViMaxTaskRun(
            session_id=session_id,
            message_id=message_id,
            call_id=call_id,
            task_id=task_id,
            tool_id=tool_id,
            mode=mode,
            status=status,
            stage=stage,
            working_dir=working_dir,
            final_video_path=final_video_path,
            error_message=error_message,
            input_payload=input_payload or {},
            runtime_status=runtime_status or {},
        )
        return await create(db, record)

    if record.session_id != session_id:
        raise ValueError(
            f"ViMax task {task_id} belongs to session {record.session_id}, not {session_id}"
        )

    record.tool_id = tool_id or record.tool_id
    record.mode = mode or record.mode
    record.status = status
    record.stage = stage
    if working_dir:
        record.working_dir = working_dir
    if final_video_path is not None:
        record.final_video_path = final_video_path or None
    record.error_message = error_message
    if input_payload is not None:
        record.input_payload = input_payload
    if runtime_status is not None:
        record.runtime_status = runtime_status
    return record


def redact_sensitive_payload(value: Any) -> Any:
    """Redact key-like values before persisting task input payloads."""
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            lowered = key.lower()
            if any(part in lowered for part in _SECRET_KEY_PARTS):
                redacted[key] = "***REDACTED***" if item else item
            else:
                redacted[key] = redact_sensitive_payload(item)
        return redacted
    if isinstance(value, list):
        return [redact_sensitive_payload(item) for item in value]
    return value
