"""Expert team catalog and summon endpoints."""

from __future__ import annotations

import asyncio
import functools
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.dependencies import (
    ExpertTeamRegistryDep,
    ExpertRoleRegistryDep,
    IndexManagerDep,
    ProviderRegistryDep,
    SessionFactoryDep,
    SettingsDep,
    SkillRegistryDep,
    StreamManagerDep,
    ToolRegistryDep,
    get_expert_role_registry,
)
from app.expert.creation_access import assert_expert_team_creation_access
from app.expert.models import (
    ExpertTeamConfig,
    ExpertTeamDetailResponse,
    ExpertTeamGenerateRequest,
    ExpertTeamGenerateResponse,
    ExpertTeamListResponse,
    ExpertTeamResumeRequest,
    ExpertTeamSummonRequest,
    ExpertTeamSummonResponse,
    ExpertTeamValidateRequest,
    ExpertTeamValidateResponse,
)
from app.expert.generator import generate_expert_team_config
from app.expert.runner import ExpertTeamRunner
from app.expert.validation import validate_expert_team_config
from app.models.message import Message
from app.streaming.events import AGENT_ERROR, DONE, SSEEvent
from app.streaming.manager import GenerationJob, StreamManager
from app.utils.id import generate_ulid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/expert-teams", tags=["expert-teams"])

VIDEO_EXPERT_TEAM_ID = "video-production"
VIDEO_EXPERT_TEAM_ENABLED = False


class ExpertTeamWriteRequest(BaseModel):
    team: ExpertTeamConfig
    model: str | None = None
    provider_id: str | None = None


def _parse_team_write_request(body: dict[str, Any]) -> ExpertTeamWriteRequest:
    try:
        if "team" in body:
            return ExpertTeamWriteRequest(**body)
        return ExpertTeamWriteRequest(team=ExpertTeamConfig(**body))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_context=False)) from exc


def _raise_if_expert_team_unavailable(team_id: str) -> None:
    if team_id == VIDEO_EXPERT_TEAM_ID and not VIDEO_EXPERT_TEAM_ENABLED:
        raise HTTPException(status_code=403, detail="视频生成专家团即将上线，本版本暂不开放使用。")


@router.get("", response_model=ExpertTeamListResponse)
async def list_expert_teams(registry: ExpertTeamRegistryDep) -> ExpertTeamListResponse:
    return ExpertTeamListResponse(teams=registry.list_teams())


@router.post("", response_model=ExpertTeamDetailResponse)
async def create_expert_team(
    body: dict[str, Any],
    registry: ExpertTeamRegistryDep,
    provider_registry: ProviderRegistryDep,
    settings: SettingsDep,
) -> ExpertTeamDetailResponse:
    request = _parse_team_write_request(body)
    assert_expert_team_creation_access(
        settings=settings,
        provider_registry=provider_registry,
        provider_id=request.provider_id,
        model=request.model,
    )
    _raise_validation_errors(request.team)
    if registry.get(request.team.id) is not None:
        raise HTTPException(status_code=409, detail="Expert team already exists")
    try:
        team = registry.save_user_team(request.team)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _detail_response(team, registry)


@router.post("/generate", response_model=ExpertTeamGenerateResponse)
async def generate_expert_team(
    body: ExpertTeamGenerateRequest,
    provider_registry: ProviderRegistryDep,
    role_registry: ExpertRoleRegistryDep,
    settings: SettingsDep,
) -> ExpertTeamGenerateResponse:
    access = assert_expert_team_creation_access(
        settings=settings,
        provider_registry=provider_registry,
        provider_id=body.provider_id,
        model=body.model,
    )
    try:
        result = await generate_expert_team_config(
            prompt=body.prompt,
            provider_registry=provider_registry,
            role_registry=role_registry,
            model=body.model,
            provider_id=access.provider_id,
            category=body.category,
            role_limit=body.role_limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Expert team generation failed")
        raise HTTPException(status_code=500, detail="Expert team generation failed") from exc
    return ExpertTeamGenerateResponse(**result)


@router.post("/validate", response_model=ExpertTeamValidateResponse)
async def validate_expert_team(body: ExpertTeamValidateRequest) -> ExpertTeamValidateResponse:
    errors = validate_expert_team_config(body.team)
    return ExpertTeamValidateResponse(valid=not errors, errors=errors)


@router.get("/{team_id}", response_model=ExpertTeamDetailResponse)
async def get_expert_team(team_id: str, registry: ExpertTeamRegistryDep) -> ExpertTeamDetailResponse:
    team = registry.get(team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Expert team not found")
    return _detail_response(team, registry)


@router.put("/{team_id}", response_model=ExpertTeamDetailResponse)
async def update_expert_team(
    team_id: str,
    body: dict[str, Any],
    registry: ExpertTeamRegistryDep,
    provider_registry: ProviderRegistryDep,
    settings: SettingsDep,
) -> ExpertTeamDetailResponse:
    request = _parse_team_write_request(body)
    assert_expert_team_creation_access(
        settings=settings,
        provider_registry=provider_registry,
        provider_id=request.provider_id,
        model=request.model,
    )
    _raise_validation_errors(request.team)
    if request.team.id != team_id:
        raise HTTPException(status_code=400, detail="Team id cannot be changed")
    if registry.get(team_id) is None:
        raise HTTPException(status_code=404, detail="Expert team not found")
    try:
        team = registry.save_user_team(request.team)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _detail_response(team, registry)


@router.delete("/{team_id}")
async def delete_expert_team(team_id: str, registry: ExpertTeamRegistryDep) -> dict[str, bool]:
    if registry.get(team_id) is None:
        raise HTTPException(status_code=404, detail="Expert team not found")
    try:
        deleted = registry.delete_user_team(team_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": deleted}


@router.post("/{team_id}/summon", response_model=ExpertTeamSummonResponse)
async def summon_expert_team(
    team_id: str,
    body: ExpertTeamSummonRequest,
    sm: StreamManagerDep,
    session_factory: SessionFactoryDep,
    provider_registry: ProviderRegistryDep,
    tool_registry: ToolRegistryDep,
    skill_registry: SkillRegistryDep,
    index_manager: IndexManagerDep,
    registry: ExpertTeamRegistryDep,
    settings: SettingsDep,
) -> ExpertTeamSummonResponse:
    team = registry.get(team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Expert team not found")
    _raise_if_expert_team_unavailable(team_id)
    _raise_validation_errors(team)
    role_registry = get_expert_role_registry()

    session_id = body.session_id or generate_ulid()
    stream_id = generate_ulid()
    job = sm.create_job(stream_id=stream_id, session_id=session_id)
    job.interactive = True

    runner = ExpertTeamRunner(
        team=team,
        request=body,
        job=job,
        session_factory=session_factory,
        provider_registry=provider_registry,
        tool_registry=tool_registry,
        skill_registry=skill_registry,
        role_registry=role_registry,
        index_manager=index_manager,
        settings=settings,
    )
    task = asyncio.create_task(
        _run_with_semaphore(sm, job, runner.run),
        name=f"expert-team-{stream_id}",
    )
    task.add_done_callback(functools.partial(_on_task_done, job=job))
    job.task = task
    return ExpertTeamSummonResponse(stream_id=stream_id, session_id=session_id)


@router.post("/{team_id}/sessions/{session_id}/resume", response_model=ExpertTeamSummonResponse)
async def resume_expert_team(
    team_id: str,
    session_id: str,
    body: ExpertTeamResumeRequest,
    sm: StreamManagerDep,
    session_factory: SessionFactoryDep,
    provider_registry: ProviderRegistryDep,
    tool_registry: ToolRegistryDep,
    skill_registry: SkillRegistryDep,
    index_manager: IndexManagerDep,
    registry: ExpertTeamRegistryDep,
    settings: SettingsDep,
) -> ExpertTeamSummonResponse:
    team = registry.get(team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Expert team not found")
    _raise_if_expert_team_unavailable(team_id)
    _raise_validation_errors(team)
    role_registry = get_expert_role_registry()
    resumable_ids = {task.id for task in team.tasks}
    if team.process.value == "hierarchical":
        resumable_ids.add("__manager__")
    if body.from_task_id not in resumable_ids:
        raise HTTPException(status_code=400, detail="Resume task not found")

    previous = await _load_previous_expert_user_message(session_factory, session_id, team_id)
    request = ExpertTeamSummonRequest(
        input=body.input or previous.get("input") or team.name,
        session_id=session_id,
        attachments=body.attachments if body.attachments is not None else previous.get("attachments", []),
        model=body.model,
        provider_id=body.provider_id,
        workspace=body.workspace,
        permission_presets=body.permission_presets,
        permission_rules=body.permission_rules,
        reasoning=body.reasoning,
        resume_from_task_id=body.from_task_id,
    )

    stream_id = generate_ulid()
    job = sm.create_job(stream_id=stream_id, session_id=session_id)
    job.interactive = True
    runner = ExpertTeamRunner(
        team=team,
        request=request,
        job=job,
        session_factory=session_factory,
        provider_registry=provider_registry,
        tool_registry=tool_registry,
        skill_registry=skill_registry,
        role_registry=role_registry,
        index_manager=index_manager,
        settings=settings,
    )
    task = asyncio.create_task(
        _run_with_semaphore(sm, job, runner.run),
        name=f"expert-team-resume-{stream_id}",
    )
    task.add_done_callback(functools.partial(_on_task_done, job=job))
    job.task = task
    return ExpertTeamSummonResponse(stream_id=stream_id, session_id=session_id)


async def _run_with_semaphore(sm: StreamManager, job: GenerationJob, run_coro) -> None:
    try:
        await asyncio.wait_for(sm._semaphore.acquire(), timeout=30)
    except asyncio.TimeoutError:
        job.publish(SSEEvent(AGENT_ERROR, {"error_message": "Server is busy. Please try again shortly."}))
        job.publish(SSEEvent(DONE, {"session_id": job.session_id, "finish_reason": "error"}))
        job.complete()
        return
    try:
        await run_coro()
    finally:
        sm._semaphore.release()


def _on_task_done(task: asyncio.Task[None], *, job: GenerationJob) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Unhandled expert team task exception %s: %s", task.get_name(), exc, exc_info=exc)
        job.publish(SSEEvent(AGENT_ERROR, {"error_message": "Expert team execution failed."}))
        job.publish(SSEEvent(DONE, {"session_id": job.session_id, "finish_reason": "error"}))
        job.complete()


def _detail_response(team: ExpertTeamConfig, registry: ExpertTeamRegistryDep) -> ExpertTeamDetailResponse:
    meta = registry.metadata(team.id)
    is_preset = bool(meta.get("is_preset"))
    return ExpertTeamDetailResponse(
        team=team,
        is_preset=is_preset,
        editable=bool(meta.get("editable", not is_preset)),
        origin=str(meta.get("origin") or ("preset" if is_preset else "user")),
        source=meta.get("source"),
        remote_id=meta.get("remote_id"),
        remote_version=meta.get("remote_version"),
        remote_channel=meta.get("remote_channel"),
    )


def _raise_validation_errors(team: ExpertTeamConfig) -> None:
    errors = validate_expert_team_config(team)
    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})


async def _load_previous_expert_user_message(
    session_factory: SessionFactoryDep,
    session_id: str,
    team_id: str,
) -> dict[str, object]:
    async with session_factory() as db:
        result = await db.execute(
            select(Message)
            .where(Message.session_id == session_id)
            .options(selectinload(Message.parts))
            .order_by(Message.time_created.desc())
        )
        for msg in result.scalars().all():
            data = msg.data or {}
            if data.get("role") != "user":
                continue
            if data.get("agent") != "expert-team" or data.get("expert_team") != team_id:
                continue
            text_parts: list[str] = []
            attachments: list[dict[str, object]] = []
            for part in msg.parts:
                part_data = part.data or {}
                if part_data.get("type") == "text":
                    text_parts.append(str(part_data.get("text") or ""))
                elif part_data.get("type") == "file":
                    attachments.append(dict(part_data))
            return {"input": "\n".join(text_parts).strip(), "attachments": attachments}
    raise HTTPException(status_code=404, detail="No previous expert team request found in this session")
