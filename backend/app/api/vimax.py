"""ViMax task control endpoints."""

from __future__ import annotations

import asyncio
import functools
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.dependencies import ProviderRegistryDep, SessionFactoryDep, SettingsDep, StreamManagerDep
from app.models.message import Message, Part
from app.models.session_file import SessionFile
from app.session.manager import create_part
from app.streaming.events import AGENT_ERROR, DONE, STEP_FINISH, TOOL_ERROR, TOOL_RESULT, TOOL_START, SSEEvent
from app.streaming.manager import GenerationJob
from app.tool.builtin.vimax_generate_video import ViMaxGenerateVideoTool, query_and_record_vimax_status
from app.tool.base import ToolResult
from app.utils.id import generate_ulid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vimax", tags=["vimax"])


class ViMaxTaskResumeRequest(BaseModel):
    session_id: str = Field(..., min_length=1)


class ViMaxTaskResumeResponse(BaseModel):
    task_id: str
    session_id: str
    stream_id: str


class ViMaxTaskStatusResponse(BaseModel):
    task_id: str
    session_id: str
    status: str
    title: str | None = None
    output: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post("/tasks/{task_id}/resume", response_model=ViMaxTaskResumeResponse)
async def resume_vimax_task(
    task_id: str,
    body: ViMaxTaskResumeRequest,
    sm: StreamManagerDep,
    session_factory: SessionFactoryDep,
    provider_registry: ProviderRegistryDep,
    settings: SettingsDep,
) -> ViMaxTaskResumeResponse:
    from app.session.vimax_task_run import get_vimax_task_run

    async with session_factory() as db:
        async with db.begin():
            record = await get_vimax_task_run(db, task_id)
            if record is None:
                raise HTTPException(status_code=404, detail=f"ViMax task not found: {task_id}")
            if record.session_id != body.session_id:
                raise HTTPException(status_code=400, detail="ViMax task does not belong to this session")

            message = await db.get(Message, record.message_id)
            if message is None:
                raise HTTPException(status_code=404, detail="Original assistant message not found")

            part = await _find_vimax_tool_part(db, body.session_id, record.message_id, record.call_id, task_id)
            if part is None:
                raise HTTPException(status_code=404, detail="ViMax tool part not found")

            tool_state = part.data.get("state") if isinstance(part.data.get("state"), dict) else {}
            if tool_state.get("status") == "running":
                raise HTTPException(status_code=409, detail=f"ViMax task is already running: {task_id}")

            tool_input = tool_state.get("input") if isinstance(tool_state.get("input"), dict) else {}
            if not tool_input:
                raise HTTPException(status_code=400, detail="ViMax tool input is missing")

            await _update_tool_part(
                part,
                status="running",
                output="ViMax task is retrying. Waiting for latest runtime progress...",
                title="ViMax retrying",
                metadata={
                    **(tool_state.get("metadata") if isinstance(tool_state.get("metadata"), dict) else {}),
                    "task_id": task_id,
                    "status": "running",
                    "stage": "resuming",
                    "message": "Retrying ViMax task from WorkCraft.",
                    "retrying": True,
                    "vimax_steps": [],
                    "vimax_artifacts": {},
                },
                time_start=_now_iso(),
                time_end=None,
            )
            record.status = "running"
            record.stage = "resuming"
            record.error_message = None
            record.runtime_status = {
                **(record.runtime_status or {}),
                "task_id": task_id,
                "status": "running",
                "stage": "resuming",
                "message": "Retrying ViMax task from WorkCraft.",
                "vimax_steps": [],
                "vimax_artifacts": {},
            }
            part_id = part.id
            message_id = record.message_id
            call_id = record.call_id
            runtime_status = dict(record.runtime_status or {})

    stream_id = generate_ulid()
    job = sm.create_job(stream_id=stream_id, session_id=body.session_id)
    job.interactive = False
    job.publish(
        SSEEvent(
            TOOL_START,
            {
                "session_id": body.session_id,
                "tool": "vimax_generate_video",
                "call_id": call_id,
                "arguments": tool_input,
                "title": "ViMax retrying",
            },
        )
    )
    job.publish(
        SSEEvent(
            "tool_metadata",
            {
                "session_id": body.session_id,
                "call_id": call_id,
                "title": "ViMax retrying",
                "metadata": {
                    **runtime_status,
                    "task_id": task_id,
                    "status": "running",
                    "stage": "resuming",
                    "message": "Retrying ViMax task from WorkCraft.",
                },
            },
        )
    )
    task = asyncio.create_task(
        _run_with_semaphore(
            sm,
            job,
            lambda: _run_vimax_resume(
                job,
                session_factory,
                provider_registry,
                task_id,
                message_id,
                call_id,
                part_id,
                tool_input,
                runtime_status,
                settings,
            ),
            on_failure=lambda error: _mark_resume_failed(
                session_factory,
                part_id=part_id,
                task_id=task_id,
                error=error,
            ),
        ),
        name=f"vimax-resume-{stream_id}",
    )
    task.add_done_callback(functools.partial(_on_task_done, job=job))
    job.task = task
    return ViMaxTaskResumeResponse(task_id=task_id, session_id=body.session_id, stream_id=stream_id)


@router.get("/tasks/{task_id}", response_model=ViMaxTaskStatusResponse)
async def get_vimax_task_status(
    task_id: str,
    session_id: str,
    session_factory: SessionFactoryDep,
    provider_registry: ProviderRegistryDep,
    settings: SettingsDep,
) -> ViMaxTaskStatusResponse:
    from app.session.vimax_task_run import get_vimax_task_run

    async with session_factory() as db:
        record = await get_vimax_task_run(db, task_id)
        if record is None:
            raise HTTPException(status_code=404, detail=f"ViMax task not found: {task_id}")
        if record.session_id != session_id:
            raise HTTPException(status_code=400, detail="ViMax task does not belong to this session")
        tool_input = dict(record.input_payload or {})
        runtime_status = dict(record.runtime_status or {})
        message_id = record.message_id
        call_id = record.call_id

    runtime_url = str(settings.vimax_runtime_url or "").rstrip("/")
    if not runtime_url:
        raise HTTPException(status_code=503, detail="ViMax runtime URL is not configured")

    job = GenerationJob(stream_id=f"vimax-status-{generate_ulid()}", session_id=session_id)
    result = await query_and_record_vimax_status(
        runtime_url=runtime_url,
        task_id=task_id,
        ctx=_build_ctx(job, session_factory, provider_registry, message_id, call_id, tool_input, runtime_status, settings),
    )
    metadata = dict(result.metadata or {})
    state = str(metadata.get("status") or ("error" if result.error else "completed"))
    return ViMaxTaskStatusResponse(
        task_id=task_id,
        session_id=session_id,
        status=state,
        title=result.title,
        output=result.output or result.error,
        metadata=metadata,
    )


async def _run_vimax_resume(
    job: GenerationJob,
    session_factory,
    provider_registry,
    task_id: str,
    message_id: str,
    call_id: str,
    part_id: str,
    tool_input: dict[str, Any],
    runtime_status: dict[str, Any],
    settings: Any,
) -> None:
    result = await ViMaxGenerateVideoTool().execute(
        {
            **tool_input,
            "action": "resume",
            "task_id": task_id,
        },
        _build_ctx(job, session_factory, provider_registry, message_id, call_id, tool_input, runtime_status, settings),
    )
    step_finish_snapshot = await _persist_resume_result(
        session_factory,
        job,
        message_id=message_id,
        part_id=part_id,
        call_id=call_id,
        task_id=task_id,
        result=result,
    )

    if result.error:
        job.publish(
            SSEEvent(
                TOOL_ERROR,
                {
                    "call_id": call_id,
                    "tool": "vimax_generate_video",
                    "output": result.error,
                    "error_message": result.error,
                    "title": result.title,
                    "metadata": result.metadata,
                },
            )
        )
        if step_finish_snapshot:
            job.publish(
                SSEEvent(
                    STEP_FINISH,
                    {
                        "session_id": job.session_id,
                        "message_id": message_id,
                        "reason": "error",
                        "tokens": {},
                        "cost": 0.0,
                        "snapshot": step_finish_snapshot,
                    },
                )
            )
    else:
        job.publish(
            SSEEvent(
                TOOL_RESULT,
                {
                    "call_id": call_id,
                    "tool": "vimax_generate_video",
                    "output": result.output[:500] if result.output else "",
                    "title": result.title,
                    "metadata": result.metadata,
                },
            )
        )
        if step_finish_snapshot:
            job.publish(
                SSEEvent(
                    STEP_FINISH,
                    {
                        "session_id": job.session_id,
                        "message_id": message_id,
                        "reason": "stop",
                        "tokens": {},
                        "cost": 0.0,
                        "snapshot": step_finish_snapshot,
                    },
                )
            )

    job.publish(
        SSEEvent(
            DONE,
            {
                "session_id": job.session_id,
                "finish_reason": "error" if result.error else "stop",
            },
        )
    )
    job.complete()


async def _persist_resume_result(
    session_factory,
    job: GenerationJob,
    *,
    message_id: str,
    part_id: str,
    call_id: str,
    task_id: str,
    result: ToolResult,
) -> dict[str, Any] | None:
    step_finish_snapshot: dict[str, Any] | None = None
    async with session_factory() as db:
        async with db.begin():
            part = await db.get(Part, part_id)
            if part is not None:
                state = dict((part.data or {}).get("state") or {})
                metadata = dict(result.metadata or {})
                metadata.pop("retrying", None)
                if "task_id" not in metadata:
                    metadata["task_id"] = task_id
                await _update_tool_part(
                    part,
                    status="completed" if result.success else "error",
                    output=result.output or result.error or "",
                    title=result.title,
                    metadata=metadata,
                    time_start=state.get("time_start"),
                    time_end=_now_iso(),
                )

            for attachment in result.attachments:
                await create_part(
                    db,
                    message_id=message_id,
                    session_id=job.session_id,
                    data={"type": "file", **attachment},
                )
                path = str(attachment.get("path") or "")
                if path:
                    await _track_session_file(db, job.session_id, path)

            step_finish_snapshot = await _persist_resume_step_finish(
                db,
                session_id=job.session_id,
                message_id=message_id,
                part_id=part_id,
                task_id=task_id,
                result=result,
            )
    return step_finish_snapshot


async def _persist_resume_step_finish(
    db,
    *,
    session_id: str,
    message_id: str,
    part_id: str,
    task_id: str,
    result: ToolResult,
) -> dict[str, Any] | None:
    snapshot = await _build_resume_step_snapshot(
        db,
        message_id=message_id,
        part_id=part_id,
        task_id=task_id,
        result=result,
    )
    if snapshot is None:
        return None

    await create_part(
        db,
        message_id=message_id,
        session_id=session_id,
        data={
            "type": "step-finish",
            "reason": "stop" if result.success else "error",
            "tokens": {},
            "cost": 0.0,
            "snapshot": snapshot,
        },
    )
    return snapshot


async def _build_resume_step_snapshot(
    db,
    *,
    message_id: str,
    part_id: str,
    task_id: str,
    result: ToolResult,
) -> dict[str, Any] | None:
    query = (
        select(Part)
        .where(Part.message_id == message_id)
        .order_by(Part.time_created.asc(), Part.id.asc())
    )
    rows = list((await db.execute(query)).scalars().all())

    current_start: dict[str, Any] | None = None
    target_start: dict[str, Any] | None = None
    target_finish: dict[str, Any] | None = None
    in_target_step = False

    for item in rows:
        data = item.data if isinstance(item.data, dict) else {}
        part_type = data.get("type")

        if part_type == "step-start":
            if in_target_step:
                break
            snapshot = data.get("snapshot") if isinstance(data.get("snapshot"), dict) else {}
            current_start = dict(snapshot) if snapshot.get("mode") == "expert-team" else None
            continue

        if item.id == part_id:
            target_start = dict(current_start or {})
            in_target_step = True
            continue

        if not in_target_step or part_type != "step-finish":
            continue

        snapshot = data.get("snapshot") if isinstance(data.get("snapshot"), dict) else {}
        if snapshot.get("mode") == "expert-team":
            target_finish = dict(snapshot)

    base = target_finish or target_start
    if not base or base.get("mode") != "expert-team":
        return None

    completed = result.success
    metadata = result.metadata if isinstance(result.metadata, dict) else {}
    message = str(metadata.get("message") or "").strip()
    final_video_path = str(metadata.get("final_video_path") or metadata.get("file_path") or "").strip()
    reason = message or ("ViMax task completed after retry." if completed else "ViMax task failed after retry.")
    preview = _resume_step_preview(
        task_id=task_id,
        result=result,
        final_video_path=final_video_path,
        reason=reason,
    )

    return {
        **base,
        "status": "completed" if completed else "failed",
        "reason": reason,
        "result_preview": preview,
    }


def _resume_step_preview(
    *,
    task_id: str,
    result: ToolResult,
    final_video_path: str,
    reason: str,
) -> str:
    if result.success:
        lines = [reason, f"Task: {task_id}"]
        if final_video_path:
            lines.append(f"Final video: {final_video_path}")
        return "\n".join(lines)

    text = (result.error or result.output or reason).strip()
    if len(text) > 2000:
        return text[:2000].rstrip() + "\n..."
    return text


async def _find_vimax_tool_part(
    db,
    session_id: str,
    message_id: str,
    call_id: str,
    task_id: str,
) -> Part | None:
    result = await db.execute(
        select(Part)
        .where(Part.session_id == session_id)
        .order_by(Part.time_created.desc())
    )
    fallback: Part | None = None
    for part in result.scalars().all():
        data = part.data if isinstance(part.data, dict) else {}
        if data.get("type") != "tool" or data.get("tool") != "vimax_generate_video":
            continue
        if part.message_id != message_id:
            state = data.get("state") if isinstance(data.get("state"), dict) else {}
            metadata = state.get("metadata") if isinstance(state.get("metadata"), dict) else {}
            if metadata.get("task_id") != task_id:
                continue
        state = data.get("state") if isinstance(data.get("state"), dict) else {}
        metadata = state.get("metadata") if isinstance(state.get("metadata"), dict) else {}
        if data.get("call_id") == call_id:
            return part
        if metadata.get("task_id") == task_id:
            fallback = part
    return fallback


async def _update_tool_part(
    part: Part,
    *,
    status: str,
    output: str,
    title: str | None,
    metadata: dict[str, Any],
    time_start: str | None,
    time_end: str | None,
) -> None:
    data = part.data if isinstance(part.data, dict) else {}
    state = data.get("state") if isinstance(data.get("state"), dict) else {}
    part.data = {
        "type": "tool",
        "tool": "vimax_generate_video",
        "call_id": str(data.get("call_id") or ""),
        "state": {
            "status": status,
            "input": state.get("input") if isinstance(state.get("input"), dict) else {},
            "output": output,
            "metadata": metadata,
            "title": title,
            "time_start": time_start,
            "time_end": time_end,
            "time_compacted": state.get("time_compacted"),
        },
    }


async def _track_session_file(db, session_id: str, file_path: str) -> None:
    path = Path(file_path)
    result = await db.execute(
        select(SessionFile.id)
        .where(SessionFile.session_id == session_id)
        .where(SessionFile.file_path == file_path)
        .limit(1)
    )
    if result.scalar_one_or_none() is not None:
        return
    db.add(
        SessionFile(
            id=generate_ulid(),
            session_id=session_id,
            file_path=file_path,
            file_name=path.name,
            tool_id="vimax_generate_video",
            file_type="generated",
        )
    )


async def _mark_resume_failed(
    session_factory,
    *,
    part_id: str,
    task_id: str,
    error: str,
) -> None:
    from app.session.vimax_task_run import get_vimax_task_run

    async with session_factory() as db:
        async with db.begin():
            part = await db.get(Part, part_id)
            if part is not None:
                state = dict((part.data or {}).get("state") or {})
                metadata = dict(state.get("metadata") or {})
                metadata.pop("retrying", None)
                metadata["task_id"] = task_id
                await _update_tool_part(
                    part,
                    status="error",
                    output=error,
                    title=f"ViMax retry failed: {task_id}",
                    metadata=metadata,
                    time_start=state.get("time_start"),
                    time_end=_now_iso(),
                )

            record = await get_vimax_task_run(db, task_id)
            if record is not None:
                record.status = "failed"
                record.stage = "failed"
                record.error_message = error
                record.runtime_status = {
                    **(record.runtime_status or {}),
                    "task_id": task_id,
                    "status": "failed",
                    "stage": "failed",
                    "message": error,
                }


def _build_ctx(
    job: GenerationJob,
    session_factory,
    provider_registry,
    message_id: str,
    call_id: str,
    tool_input: dict[str, Any],
    runtime_status: dict[str, Any],
    settings: Any,
):
    from app.schemas.agent import AgentInfo
    from app.tool.context import ToolContext

    ctx = ToolContext(
        session_id=job.session_id,
        message_id=message_id,
        agent=AgentInfo(name="workcraft", description="", mode="primary"),
        call_id=call_id,
        abort_event=job.abort_event,
    )
    ctx._app_state = {  # type: ignore[attr-defined]
        "session_factory": session_factory,
        "provider_registry": provider_registry,
        "settings": settings,
    }
    workcraft = runtime_status.get("workcraft_context") if isinstance(runtime_status.get("workcraft_context"), dict) else {}
    ctx._model_id = str(tool_input.get("model") or workcraft.get("model_id") or "")  # type: ignore[attr-defined]
    ctx._provider_id = str(tool_input.get("provider_id") or workcraft.get("provider_id") or "")  # type: ignore[attr-defined]
    ctx._publish_fn = lambda event, data: job.publish(SSEEvent(event, {"session_id": job.session_id, **data}))  # type: ignore[attr-defined]
    return ctx


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _on_task_done(task: asyncio.Task[None], *, job: GenerationJob) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Unhandled ViMax resume task exception %s: %s", task.get_name(), exc, exc_info=exc)
        job.publish(SSEEvent(AGENT_ERROR, {"error_message": "ViMax resume failed."}))
        job.publish(SSEEvent(DONE, {"session_id": job.session_id, "finish_reason": "error"}))
        job.complete()


async def _run_with_semaphore(
    sm,
    job: GenerationJob,
    build_coro: Callable[[], Awaitable[None]],
    *,
    on_failure: Callable[[str], Awaitable[None]] | None = None,
) -> None:
    try:
        await asyncio.wait_for(sm._semaphore.acquire(), timeout=30)
    except asyncio.TimeoutError:
        error = "Server is busy. Please try again shortly."
        if on_failure is not None:
            await _safe_on_failure(on_failure, error)
        job.publish(SSEEvent(AGENT_ERROR, {"error_message": error}))
        job.publish(SSEEvent(DONE, {"session_id": job.session_id, "finish_reason": "error"}))
        job.complete()
        return
    try:
        await build_coro()
    except Exception as exc:
        if on_failure is not None:
            await _safe_on_failure(on_failure, "ViMax resume failed.")
        raise exc
    finally:
        sm._semaphore.release()


async def _safe_on_failure(
    on_failure: Callable[[str], Awaitable[None]],
    error: str,
) -> None:
    try:
        await on_failure(error)
    except Exception:
        logger.debug("Failed to persist ViMax resume failure state", exc_info=True)
