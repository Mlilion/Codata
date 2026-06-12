"""ViMax video generation tool."""

from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.config import get_custom_endpoints, get_settings as _config_get_settings
from app.dependencies import get_settings as _dependency_get_settings
from app.media_model_config import DEFAULT_DATAEYES_MEDIA_BASE_URL, DEFAULT_VIMAX_MEDIA_BASE_URL, vimax_media_preset
from app.models.message import Part
from app.provider.catalog import PROVIDER_CATALOG
from app.session.vimax_task_run import (
    get_latest_vimax_task_run_for_session,
    get_vimax_task_run,
    redact_sensitive_payload,
    upsert_vimax_task_run,
)
from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext
from app.utils.id import generate_ulid
from sqlalchemy import select

TERMINAL_STATES = {"completed", "failed", "cancelled", "stale"}
DEFAULT_POLL_INTERVAL_SECONDS = 5.0
DEFAULT_MAX_WAIT_SECONDS = 3600.0
MAX_MEDIA_ATTACHMENTS = 80
MAX_ARTIFACT_INDEX_ITEMS = 300

YUNWU_BASE_URL_MARKERS = ("yunwu.ai",)
DATAEYES_BASE_URL_MARKERS = ("dataeyes.ai",)
GEMINI_MEDIA_PRESET = "gemini"
DOUBAO_MEDIA_PRESET = "doubao"
DATAEYES_MEDIA_PRESET = "dataeyes"
DATAEYES_GEMINI_VEO_MEDIA_PRESET = "dataeyes_gemini_veo"
MEDIA_EXTENSIONS = {
    ".apng",
    ".gif",
    ".jpeg",
    ".jpg",
    ".m4a",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".png",
    ".wav",
    ".webm",
    ".webp",
}
INDEXED_ARTIFACT_EXTENSIONS = MEDIA_EXTENSIONS | {".json", ".txt", ".srt", ".vtt"}
VIDEO_EXTENSIONS = {".mkv", ".mov", ".mp4", ".webm"}
IMAGE_EXTENSIONS = {".apng", ".gif", ".jpeg", ".jpg", ".png", ".webp"}
AUDIO_EXTENSIONS = {".m4a", ".mp3", ".wav"}
METADATA_EXTENSIONS = {".json", ".txt", ".srt", ".vtt"}
logger = logging.getLogger(__name__)


def get_settings(ctx: ToolContext | None = None) -> Any:
    app_state = getattr(ctx, "_app_state", None)
    if isinstance(app_state, dict) and app_state.get("settings") is not None:
        return app_state["settings"]

    try:
        return _dependency_get_settings()
    except RuntimeError:
        return _config_get_settings()


class ViMaxGenerateVideoTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "vimax_generate_video"

    @property
    def description(self) -> str:
        return (
            "Generate a video through the local ViMax runtime. Use mode='script2video' "
            "when a script is already available, or mode='idea2video' when only an idea "
            "is available. The tool submits a ViMax task, can poll an existing task, and "
            "can resume a failed task by reusing its task_id and working directory."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["submit", "status", "cancel", "resume"],
                    "description": "Task action. Use resume to rerun an existing ViMax task without discarding generated assets.",
                    "default": "submit",
                },
                "task_id": {
                    "type": "string",
                    "description": "Existing ViMax task id for status, cancel, or resume actions.",
                },
                "mode": {
                    "type": "string",
                    "enum": ["idea2video", "script2video"],
                    "description": "Generation mode. Required for submit.",
                    "default": "script2video",
                },
                "idea": {
                    "type": "string",
                    "description": "Video idea or concept for idea2video mode.",
                },
                "script": {
                    "type": "string",
                    "description": "Scene script for script2video mode.",
                },
                "user_requirement": {
                    "type": "string",
                    "description": "Creative constraints such as shot count, duration, tone, or audience.",
                },
                "style": {
                    "type": "string",
                    "description": "Visual style, e.g. realistic, anime, cinematic.",
                },
                "runtime_url": {
                    "type": "string",
                    "description": "Optional ViMax runtime URL. Defaults to WORKCRAFT_VIMAX_RUNTIME_URL.",
                },
                "config_path": {
                    "type": "string",
                    "description": "Optional ViMax YAML config path. Defaults to WORKCRAFT_VIMAX_CONFIG_PATH.",
                },
                "wait": {
                    "type": "boolean",
                    "description": "Whether to wait for completion after submit. Defaults to true.",
                    "default": True,
                },
                "max_wait_seconds": {
                    "type": "integer",
                    "description": "Maximum time to wait when wait=true. Defaults to 3600.",
                    "default": int(DEFAULT_MAX_WAIT_SECONDS),
                },
                "poll_interval_seconds": {
                    "type": "integer",
                    "description": "Polling interval when waiting. Defaults to 5.",
                    "default": int(DEFAULT_POLL_INTERVAL_SECONDS),
                },
                "config_overrides": {
                    "type": "object",
                    "description": "Advanced ViMax config overrides merged into the YAML config for this task.",
                },
                "media_provider": {
                    "type": "string",
                    "enum": ["auto", "google", "yunwu", "dataeyes", "config"],
                    "description": (
                        "Media generator credential source. auto injects only init_args.api_key into the "
                        "YAML-defined image/video generator classes. config keeps the YAML media config."
                    ),
                    "default": "auto",
                },
                "media_preset": {
                    "type": "string",
                    "enum": ["", "config", "gemini", "doubao", "dataeyes", "dataeyes_gemini_veo"],
                    "description": (
                        "Task-scoped ViMax media generator preset. gemini uses ViMax's Yunwu Gemini/Veo "
                        "generators; doubao uses ViMax's Yunwu Doubao Seedream/Seedance generators; "
                        "dataeyes uses ViMax's DataEyes Doubao Seedream/Seedance generators; "
                        "dataeyes_gemini_veo uses ViMax's DataEyes Gemini/Veo generators. "
                        "config keeps the YAML media generator classes."
                    ),
                    "default": "",
                },
            },
            "required": [],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        action = str(args.get("action") or "submit")
        runtime_url = _runtime_url(args, ctx)
        if not runtime_url:
            return ToolResult(
                error=(
                    "ViMax runtime is not configured. Start the local ViMax runtime and set "
                    "WORKCRAFT_VIMAX_RUNTIME_URL, or pass runtime_url."
                )
            )

        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=60.0)) as client:
            if action == "status":
                task_id = str(args.get("task_id") or "").strip()
                if not task_id:
                    return ToolResult(error="task_id is required for status.")
                return await self._status(client, runtime_url, task_id, ctx=ctx)

            if action == "cancel":
                task_id = str(args.get("task_id") or "").strip()
                if not task_id:
                    return ToolResult(error="task_id is required for cancel.")
                return await self._cancel(client, runtime_url, task_id, ctx=ctx)

            if action == "resume":
                return await self._resume(client, runtime_url, args, ctx)

            if action != "submit":
                return ToolResult(error=f"Unsupported action: {action}")

            submit_payload = self._build_submit_payload(args, ctx, resume_task_id="")
            if isinstance(submit_payload, str):
                return ToolResult(error=submit_payload)

            try:
                resp = await client.post(f"{runtime_url}/tasks", json=submit_payload)
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                return ToolResult(error=f"Failed to submit ViMax task: {exc}")

            status = resp.json()
            task_id = str(status.get("task_id") or "")
            await _record_task_status(ctx, args, status, tool_id=self.id)
            ctx.publish_metadata(title="ViMax task submitted", metadata=_status_metadata(status))

            if not bool(args.get("wait", True)):
                return _task_result(status, output_prefix="ViMax task submitted.")

            return await self._wait_for_completion(
                client,
                runtime_url,
                task_id,
                ctx,
                max_wait_seconds=float(args.get("max_wait_seconds") or DEFAULT_MAX_WAIT_SECONDS),
                poll_interval_seconds=float(args.get("poll_interval_seconds") or DEFAULT_POLL_INTERVAL_SECONDS),
            )

    def _build_submit_payload(self, args: dict[str, Any], ctx: ToolContext, *, resume_task_id: str = "") -> dict[str, Any] | str:
        settings = get_settings(ctx)
        mode = str(args.get("mode") or "script2video")
        idea = str(args.get("idea") or "")
        script = str(args.get("script") or "")
        config_path = str(args.get("config_path") or settings.vimax_config_path or "").strip()
        if not config_path:
            return "ViMax config_path is required. Set WORKCRAFT_VIMAX_CONFIG_PATH or pass config_path."
        if mode == "idea2video" and not idea.strip():
            return "idea is required for idea2video."
        if mode == "script2video" and not script.strip():
            return "script is required for script2video."

        config_overrides: dict[str, Any] = {}
        raw_overrides = args.get("config_overrides")
        if isinstance(raw_overrides, dict):
            config_overrides = _deep_merge(config_overrides, raw_overrides)
        media_provider = str(args.get("media_provider") or "auto")
        media_preset = str(args.get("media_preset") or getattr(settings, "vimax_media_preset", "")).strip()
        workcraft_overrides = _workcraft_config_overrides(
            ctx,
            settings,
            media_provider=media_provider,
            media_preset=media_preset,
        )
        if isinstance(workcraft_overrides, str):
            return workcraft_overrides
        config_overrides = _deep_merge(config_overrides, workcraft_overrides)

        return {
            "mode": mode,
            "config_path": config_path,
            "idea": idea,
            "script": script,
            "user_requirement": str(args.get("user_requirement") or ""),
            "style": str(args.get("style") or ""),
            "config_overrides": config_overrides,
            "metadata": _workcraft_task_metadata(ctx, resume_task_id=resume_task_id),
        }

    async def _status(
        self,
        client: httpx.AsyncClient,
        runtime_url: str,
        task_id: str,
        *,
        ctx: ToolContext | None = None,
    ) -> ToolResult:
        try:
            resp = await client.get(f"{runtime_url}/tasks/{task_id}")
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return ToolResult(error=f"ViMax task not found: {task_id}")
            return ToolResult(error=f"Failed to query ViMax task: HTTP {exc.response.status_code}")
        except httpx.HTTPError as exc:
            return ToolResult(error=f"Failed to query ViMax task: {exc}")
        status = resp.json()
        if ctx is not None:
            await _record_task_status(ctx, {"action": "status", "task_id": task_id}, status, tool_id=self.id)
        return _task_result(status, output_prefix="ViMax task status.")

    async def _cancel(
        self,
        client: httpx.AsyncClient,
        runtime_url: str,
        task_id: str,
        *,
        ctx: ToolContext | None = None,
    ) -> ToolResult:
        try:
            resp = await client.post(f"{runtime_url}/tasks/{task_id}/cancel")
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return ToolResult(error=f"ViMax task not found: {task_id}")
            return ToolResult(error=f"Failed to cancel ViMax task: HTTP {exc.response.status_code}")
        except httpx.HTTPError as exc:
            return ToolResult(error=f"Failed to cancel ViMax task: {exc}")
        status = resp.json()
        if ctx is not None:
            await _record_task_status(ctx, {"action": "cancel", "task_id": task_id}, status, tool_id=self.id)
        return _task_result(status, output_prefix="ViMax task cancellation requested.")

    async def _resume(
        self,
        client: httpx.AsyncClient,
        runtime_url: str,
        args: dict[str, Any],
        ctx: ToolContext,
    ) -> ToolResult:
        task_id = str(args.get("task_id") or "").strip()
        resume_args = dict(args)
        previous = await _find_resume_task(ctx, task_id=task_id)
        if previous:
            task_id = task_id or previous["task_id"]
            resume_args = _deep_merge(previous.get("input", {}), resume_args)
            resume_args["task_id"] = task_id
        if not task_id:
            previous = await _latest_session_task(ctx)
            if not previous:
                return ToolResult(error="No previous ViMax task found in this WorkCraft session. Pass task_id to resume.")
            task_id = previous["task_id"]
            resume_args = _deep_merge(previous.get("input", {}), resume_args)
            resume_args["task_id"] = task_id
        if not task_id:
            return ToolResult(error="task_id is required for resume.")

        submit_payload = self._build_submit_payload(resume_args, ctx, resume_task_id=task_id)
        if isinstance(submit_payload, str):
            return ToolResult(error=submit_payload)

        try:
            resp = await client.post(f"{runtime_url}/tasks/{task_id}/resume", json=submit_payload)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return ToolResult(error=f"ViMax task not found: {task_id}")
            if exc.response.status_code == 409:
                return ToolResult(error=f"ViMax task is already running: {task_id}")
            return ToolResult(error=f"Failed to resume ViMax task {task_id}: HTTP {exc.response.status_code}")
        except httpx.HTTPError as exc:
            return ToolResult(error=f"Failed to resume ViMax task {task_id}: {exc}")

        status = resp.json()
        await _record_task_status(ctx, resume_args, status, tool_id=self.id)
        ctx.publish_metadata(title="ViMax task resumed", metadata=_status_metadata(status))

        if not bool(resume_args.get("wait", True)):
            return _task_result(status, output_prefix="ViMax task resumed.")

        return await self._wait_for_completion(
            client,
            runtime_url,
            task_id,
            ctx,
            max_wait_seconds=float(resume_args.get("max_wait_seconds") or DEFAULT_MAX_WAIT_SECONDS),
            poll_interval_seconds=float(resume_args.get("poll_interval_seconds") or DEFAULT_POLL_INTERVAL_SECONDS),
        )

    async def _wait_for_completion(
        self,
        client: httpx.AsyncClient,
        runtime_url: str,
        task_id: str,
        ctx: ToolContext,
        *,
        max_wait_seconds: float,
        poll_interval_seconds: float,
    ) -> ToolResult:
        deadline = asyncio.get_running_loop().time() + max(0.0, max_wait_seconds)
        last_status: dict[str, Any] = {}
        while True:
            if ctx.is_aborted:
                await self._cancel(client, runtime_url, task_id)
                return ToolResult(error=f"ViMax task cancelled because the WorkCraft run was aborted: {task_id}")

            try:
                resp = await client.get(f"{runtime_url}/tasks/{task_id}")
                resp.raise_for_status()
                last_status = resp.json()
            except httpx.HTTPError as exc:
                return ToolResult(error=f"Failed while polling ViMax task {task_id}: {exc}")

            await _record_task_status(ctx, {"action": "status", "task_id": task_id}, last_status, tool_id=self.id)
            ctx.publish_metadata(title="ViMax task progress", metadata=_status_metadata(last_status))
            if str(last_status.get("status")) in TERMINAL_STATES:
                return _task_result(
                    last_status,
                    output_prefix="ViMax task finished.",
                    require_video=True,
                    block_on_error=True,
                )

            if asyncio.get_running_loop().time() >= deadline:
                return _task_result(
                    last_status,
                    output_prefix=(
                        f"ViMax task did not finish within {max_wait_seconds:.0f}s. "
                        "It is still running, so this render step is not complete. "
                        "Call vimax_generate_video with "
                        f'action="status" and task_id="{task_id}" to check again.'
                    ),
                    require_terminal=True,
                    block_on_error=True,
                )

            await asyncio.sleep(max(1.0, poll_interval_seconds))


def _runtime_url(args: dict[str, Any], ctx: ToolContext | None = None) -> str:
    settings = get_settings(ctx)
    return str(args.get("runtime_url") or settings.vimax_runtime_url or "").rstrip("/")


def _task_result(
    status: dict[str, Any],
    *,
    output_prefix: str,
    require_terminal: bool = False,
    require_video: bool = False,
    block_on_error: bool = False,
) -> ToolResult:
    task_id = str(status.get("task_id") or "")
    state = str(status.get("status") or "")
    final_video_path = str(status.get("final_video_path") or "")
    output = output_prefix + "\n" + json.dumps(_public_status(status), ensure_ascii=False, indent=2)
    metadata = _status_metadata(status)
    artifact_index = _collect_artifacts(status)
    if artifact_index["items"]:
        metadata["vimax_artifacts"] = artifact_index
    attachments = _attachments_from_artifacts(artifact_index)
    if artifact_index["final_video"]:
        metadata["file_path"] = artifact_index["final_video"]["path"]
        metadata["title"] = artifact_index["final_video"]["name"]
    output = _append_artifact_summary(output, artifact_index)

    if state == "failed":
        return ToolResult(
            error=output,
            metadata=_error_metadata(metadata, block_on_error=block_on_error),
            title=f"ViMax failed: {task_id}",
            attachments=attachments,
        )
    if state == "cancelled":
        return ToolResult(
            error=output,
            metadata=_error_metadata(metadata, block_on_error=block_on_error),
            title=f"ViMax cancelled: {task_id}",
            attachments=attachments,
        )
    if state == "stale":
        return ToolResult(
            error=output,
            metadata=_error_metadata(metadata, block_on_error=block_on_error),
            title=f"ViMax interrupted: {task_id}",
            attachments=attachments,
        )
    if require_terminal and state not in TERMINAL_STATES:
        return ToolResult(
            error=output,
            metadata=_error_metadata(metadata, block_on_error=block_on_error),
            title=f"ViMax still running: {task_id}",
            attachments=attachments,
        )

    if require_video and state == "completed" and not artifact_index["final_video"]:
        detail = "ViMax reported completed, but final_video_path is missing or the file is not accessible."
        return ToolResult(
            error=output + "\n\n" + detail,
            metadata=_error_metadata(metadata, block_on_error=block_on_error),
            title=f"ViMax video unavailable: {task_id}",
            attachments=attachments,
        )

    return ToolResult(
        output=output,
        title=f"ViMax video: {task_id}",
        metadata=metadata,
        attachments=attachments,
    )


def _status_metadata(status: dict[str, Any]) -> dict[str, Any]:
    progress = status.get("metadata", {}).get("progress") if isinstance(status.get("metadata"), dict) else None
    if not isinstance(progress, dict):
        progress = {}
    steps = status.get("steps") if isinstance(status.get("steps"), list) else progress.get("steps")
    events = status.get("events") if isinstance(status.get("events"), list) else progress.get("events")
    artifacts = status.get("artifacts") if isinstance(status.get("artifacts"), dict) else progress.get("artifacts")
    metadata = {
        "task_id": status.get("task_id"),
        "mode": status.get("mode"),
        "status": status.get("status"),
        "progress": status.get("progress"),
        "stage": status.get("stage"),
        "message": status.get("message"),
        "working_dir": status.get("working_dir"),
        "final_video_path": status.get("final_video_path"),
        "vimax_steps": steps if isinstance(steps, list) else [],
        "vimax_events": events if isinstance(events, list) else [],
        "vimax_progress": progress,
        "vimax_artifacts": artifacts if isinstance(artifacts, dict) else {},
        "stale": bool(status.get("stale")),
        "workcraft_context": (status.get("metadata") or {}).get("workcraft")
        if isinstance(status.get("metadata"), dict)
        else None,
    }
    return metadata


def _error_metadata(metadata: dict[str, Any], *, block_on_error: bool) -> dict[str, Any]:
    if not block_on_error:
        return metadata
    return {**metadata, "blocking_error": True}


def _collect_artifacts(status: dict[str, Any]) -> dict[str, Any]:
    runtime_artifacts = status.get("artifacts")
    if not isinstance(runtime_artifacts, dict):
        metadata = status.get("metadata") if isinstance(status.get("metadata"), dict) else {}
        progress = metadata.get("progress") if isinstance(metadata.get("progress"), dict) else {}
        runtime_artifacts = progress.get("artifacts") if isinstance(progress.get("artifacts"), dict) else None
    if isinstance(runtime_artifacts, dict) and runtime_artifacts.get("items"):
        return _normalize_runtime_artifacts(runtime_artifacts)

    working_dir = _existing_dir(status.get("working_dir"))
    final_video_path = _existing_file(status.get("final_video_path"))
    roots: list[Path] = []
    if working_dir:
        roots.append(working_dir)
    if final_video_path and (not working_dir or working_dir not in final_video_path.parents):
        roots.append(final_video_path.parent)

    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for path in _iter_artifact_paths(roots, final_video_path=final_video_path):
        resolved = str(path.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        item = _artifact_item(path, working_dir=working_dir, final_video_path=final_video_path)
        if item is not None:
            items.append(item)
        if len(items) >= MAX_ARTIFACT_INDEX_ITEMS:
            break

    counts = {"image": 0, "video": 0, "audio": 0, "metadata": 0, "other": 0}
    for item in items:
        kind = str(item.get("kind") or "other")
        counts[kind] = counts.get(kind, 0) + 1

    final_item = next((item for item in items if item.get("role") == "final_video"), None)
    return {
        "working_dir": str(working_dir) if working_dir else "",
        "final_video": final_item,
        "counts": counts,
        "items": items,
        "truncated": len(items) >= MAX_ARTIFACT_INDEX_ITEMS,
    }


def _normalize_runtime_artifacts(artifact_index: dict[str, Any]) -> dict[str, Any]:
    items = [item for item in artifact_index.get("items") or [] if isinstance(item, dict)]
    counts = artifact_index.get("counts") if isinstance(artifact_index.get("counts"), dict) else {}
    final_item = artifact_index.get("final_video") if isinstance(artifact_index.get("final_video"), dict) else None
    if final_item is None:
        final_item = next((item for item in items if item.get("role") == "final_video"), None)
    return {
        "working_dir": str(artifact_index.get("working_dir") or ""),
        "final_video": final_item,
        "counts": {
            "image": int(counts.get("image") or 0),
            "video": int(counts.get("video") or 0),
            "audio": int(counts.get("audio") or 0),
            "metadata": int(counts.get("metadata") or 0),
            "other": int(counts.get("other") or 0),
        },
        "items": items,
        "truncated": bool(artifact_index.get("truncated")),
    }


def _iter_artifact_paths(roots: list[Path], *, final_video_path: Path | None) -> list[Path]:
    candidates: list[Path] = []
    if final_video_path:
        candidates.append(final_video_path)
    for root in roots:
        try:
            for path in root.rglob("*"):
                if path.is_file() and path.suffix.lower() in INDEXED_ARTIFACT_EXTENSIONS:
                    candidates.append(path)
        except OSError:
            continue
    return sorted(candidates, key=lambda path: _artifact_sort_key(path, final_video_path=final_video_path))


def _artifact_sort_key(path: Path, *, final_video_path: Path | None) -> tuple[int, str]:
    if final_video_path and path.resolve() == final_video_path.resolve():
        return (0, str(path))
    parts = {part.lower() for part in path.parts}
    suffix = path.suffix.lower()
    name = path.name.lower()
    if "shots" in parts and suffix in VIDEO_EXTENSIONS:
        return (10, str(path))
    if "shots" in parts and name in {"first_frame.png", "last_frame.png"}:
        return (20, str(path))
    if "character_portraits" in parts and suffix in IMAGE_EXTENSIONS:
        return (30, str(path))
    if suffix in VIDEO_EXTENSIONS:
        return (40, str(path))
    if suffix in IMAGE_EXTENSIONS:
        return (50, str(path))
    if suffix in AUDIO_EXTENSIONS:
        return (60, str(path))
    return (90, str(path))


def _artifact_item(path: Path, *, working_dir: Path | None, final_video_path: Path | None) -> dict[str, Any] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    suffix = path.suffix.lower()
    kind = _artifact_kind(suffix)
    relative_path = _relative_artifact_path(path, working_dir=working_dir)
    role = _artifact_role(path, relative_path=relative_path, final_video_path=final_video_path)
    mime_type = mimetypes.guess_type(path.name)[0] or _default_mime_type(suffix)
    return {
        "name": relative_path or path.name,
        "basename": path.name,
        "path": str(path.resolve()),
        "relative_path": relative_path,
        "size": stat.st_size,
        "mime_type": mime_type,
        "kind": kind,
        "role": role,
    }


def _attachments_from_artifacts(artifact_index: dict[str, Any]) -> list[dict[str, Any]]:
    attachments: list[dict[str, Any]] = []
    for item in artifact_index.get("items") or []:
        if item.get("kind") not in {"image", "video", "audio"}:
            continue
        attachments.append(
            {
                "file_id": generate_ulid(),
                "name": item["name"],
                "path": item["path"],
                "size": item["size"],
                "mime_type": item["mime_type"],
                "source": "referenced",
                "vimax_role": item["role"],
                "vimax_kind": item["kind"],
                "relative_path": item["relative_path"],
            }
        )
        if len(attachments) >= MAX_MEDIA_ATTACHMENTS:
            break
    return attachments


def _append_artifact_summary(output: str, artifact_index: dict[str, Any]) -> str:
    counts = artifact_index.get("counts") or {}
    items = artifact_index.get("items") or []
    if not items:
        return output
    lines = [
        "",
        "ViMax artifacts discovered:",
        (
            f"- videos: {counts.get('video', 0)}, images: {counts.get('image', 0)}, "
            f"audio: {counts.get('audio', 0)}, metadata: {counts.get('metadata', 0)}"
        ),
    ]
    final_video = artifact_index.get("final_video")
    if final_video:
        lines.append(f"- final video: {final_video['path']}")
    for item in items[:20]:
        if item.get("kind") not in {"image", "video", "audio"}:
            continue
        lines.append(f"- [{item['role']}] {item['path']}")
    if len(items) > 20:
        lines.append(f"- ... {len(items) - 20} more artifact(s) indexed in metadata.vimax_artifacts")
    return output + "\n" + "\n".join(lines)


def _existing_file(value: Any) -> Path | None:
    if not str(value or "").strip():
        return None
    path = Path(str(value or "")).expanduser()
    try:
        return path.resolve() if path.exists() and path.is_file() else None
    except OSError:
        return None


def _existing_dir(value: Any) -> Path | None:
    if not str(value or "").strip():
        return None
    path = Path(str(value or "")).expanduser()
    try:
        return path.resolve() if path.exists() and path.is_dir() else None
    except OSError:
        return None


def _relative_artifact_path(path: Path, *, working_dir: Path | None) -> str:
    if working_dir:
        try:
            return path.resolve().relative_to(working_dir.resolve()).as_posix()
        except ValueError:
            pass
    return path.name


def _artifact_kind(suffix: str) -> str:
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if suffix in AUDIO_EXTENSIONS:
        return "audio"
    if suffix in METADATA_EXTENSIONS:
        return "metadata"
    return "other"


def _artifact_role(path: Path, *, relative_path: str, final_video_path: Path | None) -> str:
    if final_video_path and path.resolve() == final_video_path.resolve():
        return "final_video"
    parts = relative_path.split("/")
    name = path.name.lower()
    if len(parts) >= 3 and parts[0] == "shots" and name == "video.mp4":
        return "shot_video"
    if len(parts) >= 3 and parts[0] == "shots" and name in {"first_frame.png", "last_frame.png"}:
        return name.removesuffix(".png")
    if len(parts) >= 3 and parts[0] == "shots" and name.startswith("transition_video_"):
        return "transition_video"
    if len(parts) >= 3 and parts[0] == "shots" and name.startswith("new_camera_"):
        return "camera_image"
    if parts and parts[0] == "character_portraits":
        return "character_portrait"
    if path.suffix.lower() in METADATA_EXTENSIONS:
        return "metadata"
    return _artifact_kind(path.suffix.lower())


def _default_mime_type(suffix: str) -> str:
    if suffix in VIDEO_EXTENSIONS:
        return "video/mp4"
    if suffix in IMAGE_EXTENSIONS:
        return "image/png"
    if suffix in AUDIO_EXTENSIONS:
        return "audio/mpeg"
    if suffix == ".json":
        return "application/json"
    return "application/octet-stream"


def _public_status(status: dict[str, Any]) -> dict[str, Any]:
    public = {key: value for key, value in _status_metadata(status).items() if value not in (None, "")}
    if not public.get("vimax_artifacts"):
        public["vimax_artifacts"] = _collect_artifacts(status)
    return public


def _workcraft_config_overrides(
    ctx: ToolContext,
    settings: Any,
    *,
    media_provider: str = "auto",
    media_preset: str = "",
) -> dict[str, Any] | str:
    overrides: dict[str, Any] = {}
    provider_id, model_id = _model_context(ctx)
    chat_model_override = _chat_model_override(provider_id, model_id, settings)
    if chat_model_override:
        overrides = _deep_merge(overrides, {"chat_model": {"init_args": chat_model_override}})

    media_override = _media_generator_override(
        settings,
        provider_id=provider_id,
        media_provider=media_provider,
        media_preset=media_preset,
    )
    if isinstance(media_override, str):
        return media_override
    if media_override:
        overrides = _deep_merge(overrides, media_override)
    return overrides


def _model_context(ctx: ToolContext) -> tuple[str, str]:
    provider_id = str(getattr(ctx, "_provider_id", "") or "")
    model_id = str(getattr(ctx, "_model_id", "") or "")
    if provider_id or not model_id:
        return provider_id, model_id

    app_state = getattr(ctx, "_app_state", None)
    if not isinstance(app_state, dict):
        return provider_id, model_id

    registry = app_state.get("provider_registry")
    resolve_model = getattr(registry, "resolve_model", None)
    if not callable(resolve_model):
        return provider_id, model_id

    try:
        resolved = resolve_model(model_id)
    except Exception:
        return provider_id, model_id
    if not resolved:
        return provider_id, model_id

    provider = resolved[0]
    provider_id = str(getattr(provider, "id", "") or "")
    return provider_id, model_id


def _media_generator_override(
    settings: Any,
    *,
    provider_id: str,
    media_provider: str,
    media_preset: str = "",
) -> dict[str, Any] | str:
    provider = media_provider.strip().lower()
    if provider not in {"auto", "google", "yunwu", "dataeyes", "config"}:
        return f"Unsupported ViMax media_provider: {media_provider}"
    preset = _normalize_media_preset(media_preset)
    if isinstance(preset, str) and preset.startswith("Unsupported"):
        return preset
    if provider == "config" and preset in {"", "config"}:
        return {}
    if provider != "config" and preset == "config":
        return {}

    dataeyes_presets = {DATAEYES_MEDIA_PRESET, DATAEYES_GEMINI_VEO_MEDIA_PRESET}
    key_provider = "dataeyes" if preset in dataeyes_presets else "yunwu" if preset in {GEMINI_MEDIA_PRESET, DOUBAO_MEDIA_PRESET} else provider
    media_key = _media_api_key(settings, provider_id=provider_id, media_provider=key_provider)
    if not media_key:
        if preset in dataeyes_presets:
            return (
                f"ViMax media_preset '{preset}' requires a DataEyes-compatible media API key. "
                "Set WORKCRAFT_VIMAX_MEDIA_API_KEY or configure a custom endpoint whose base_url contains dataeyes.ai."
            )
        if preset in {GEMINI_MEDIA_PRESET, DOUBAO_MEDIA_PRESET}:
            return (
                f"ViMax media_preset '{preset}' requires a Yunwu-compatible media API key. "
                "Set WORKCRAFT_VIMAX_MEDIA_API_KEY, WORKCRAFT_VIMAX_YUNWU_API_KEY, "
                "or configure a custom endpoint whose base_url contains yunwu.ai."
            )


        return {}

    if preset == GEMINI_MEDIA_PRESET:
        return _gemini_media_preset_override(settings, api_key=media_key)
    if preset == DOUBAO_MEDIA_PRESET:
        return _doubao_media_preset_override(settings, api_key=media_key)
    if preset == DATAEYES_MEDIA_PRESET:
        return _dataeyes_media_preset_override(settings, api_key=media_key)
    if preset == DATAEYES_GEMINI_VEO_MEDIA_PRESET:
        return _dataeyes_gemini_veo_media_preset_override(settings, api_key=media_key)
    if preset == "config" and provider != "config":
        return _media_credentials_override(settings, api_key=media_key)

    return _media_credentials_override(settings, api_key=media_key)


def _normalize_media_preset(media_preset: str) -> str:
    preset = media_preset.strip().lower()
    if preset in {"", "auto"}:
        return ""
    aliases = {
        "config": "config",
        "yaml": "config",
        "default": "config",
        "gemini": GEMINI_MEDIA_PRESET,
        "google": GEMINI_MEDIA_PRESET,
        "veo": GEMINI_MEDIA_PRESET,
        "nanobanana": GEMINI_MEDIA_PRESET,
        "doubao": DOUBAO_MEDIA_PRESET,
        "seedream": DOUBAO_MEDIA_PRESET,
        "seedance": DOUBAO_MEDIA_PRESET,
        "dataeye": DATAEYES_MEDIA_PRESET,
        "dataeyes": DATAEYES_MEDIA_PRESET,
        "dataeyes_gemini": DATAEYES_GEMINI_VEO_MEDIA_PRESET,
        "dataeyes_veo": DATAEYES_GEMINI_VEO_MEDIA_PRESET,
        "dataeyes_gemini_veo": DATAEYES_GEMINI_VEO_MEDIA_PRESET,
        "dataeyes_nanobanana": DATAEYES_GEMINI_VEO_MEDIA_PRESET,
    }
    normalized = aliases.get(preset)
    if normalized:
        return normalized
    return f"Unsupported ViMax media_preset: {media_preset}"


def _media_credentials_override(settings: Any, *, api_key: str) -> dict[str, Any]:
    init_args: dict[str, Any] = {"api_key": api_key}
    media_base_url = _setting(settings, "vimax_media_base_url")
    if media_base_url:
        init_args["base_url"] = media_base_url
    image_args = dict(init_args)
    video_args = dict(init_args)
    image_api_version = (
        _setting(settings, "vimax_image_api_version")
        or _setting(settings, "vimax_media_api_version")
    )
    video_api_version = _setting(settings, "vimax_video_api_version")
    if image_api_version:
        image_args["api_version"] = image_api_version
    if video_api_version:
        video_args["api_version"] = video_api_version

    return {
        "image_generator": {"init_args": image_args},
        "video_generator": {"init_args": video_args},
    }


def _gemini_media_preset_override(settings: Any, *, api_key: str) -> dict[str, Any]:
    preset = vimax_media_preset(GEMINI_MEDIA_PRESET)
    preset_image = preset["image"]
    preset_video = preset["video"]
    base_url = _versionless_media_base_url(_setting(settings, "vimax_media_base_url") or DEFAULT_VIMAX_MEDIA_BASE_URL)
    video_model = _setting(settings, "vimax_video_model") or preset_video["model"]
    image_args: dict[str, Any] = {
        "api_key": api_key,
        "base_url": base_url,
        "api_version": _setting(settings, "vimax_image_api_version")
        or _setting(settings, "vimax_media_api_version")
        or preset_image["api_version"],
        "model": _setting(settings, "vimax_image_model") or preset_image["model"],
    }
    video_args: dict[str, Any] = {
        "api_key": api_key,
        "base_url": base_url,
        "api_version": _setting(settings, "vimax_video_api_version") or preset_video["api_version"],
        "t2v_model": _setting(settings, "vimax_video_t2v_model") or video_model,
        "ff2v_model": _setting(settings, "vimax_video_ff2v_model") or video_model,
        "flf2v_model": _setting(settings, "vimax_video_flf2v_model") or video_model,
    }
    return {
        "image_generator": {
            "__replace__": True,
            "class_path": "tools.ImageGeneratorNanobananaYunwuAPI",
            "init_args": image_args,
        },
        "video_generator": {
            "__replace__": True,
            "class_path": "tools.VideoGeneratorVeoYunwuAPI",
            "init_args": video_args,
        },
    }


def _versionless_media_base_url(base_url: str) -> str:
    value = base_url.strip().rstrip("/")
    for suffix in ("/v1beta", "/v1"):
        if value.lower().endswith(suffix):
            return value[: -len(suffix)]
    return value


def _doubao_media_preset_override(settings: Any, *, api_key: str) -> dict[str, Any]:
    preset = vimax_media_preset(DOUBAO_MEDIA_PRESET)
    preset_image = preset["image"]
    preset_video = preset["video"]
    video_model = _setting(settings, "vimax_video_model") or preset_video["model"]
    return {
        "image_generator": {
            "__replace__": True,
            "class_path": "tools.ImageGeneratorDoubaoSeedreamYunwuAPI",
            "init_args": {
                "api_key": api_key,
                "model": _setting(settings, "vimax_image_model") or preset_image["model"],
            },
        },
        "video_generator": {
            "__replace__": True,
            "class_path": "tools.VideoGeneratorDoubaoSeedanceYunwuAPI",
            "init_args": {
                "api_key": api_key,
                "t2v_model": _setting(settings, "vimax_video_t2v_model") or preset_video["t2v_model"],
                "ff2v_model": _setting(settings, "vimax_video_ff2v_model") or video_model,
                "flf2v_model": _setting(settings, "vimax_video_flf2v_model") or video_model,
            },
        },
    }


def _dataeyes_media_preset_override(settings: Any, *, api_key: str) -> dict[str, Any]:
    preset = vimax_media_preset(DATAEYES_MEDIA_PRESET)
    preset_image = preset["image"]
    preset_video = preset["video"]
    base_url = _versionless_media_base_url(_setting(settings, "vimax_media_base_url") or DEFAULT_DATAEYES_MEDIA_BASE_URL)
    video_model = _setting(settings, "vimax_video_model") or preset_video["model"]
    return {
        "image_generator": {
            "__replace__": True,
            "class_path": "tools.ImageGeneratorDoubaoSeedreamDataEyesAPI",
            "init_args": {
                "api_key": api_key,
                "base_url": base_url,
                "api_version": _setting(settings, "vimax_image_api_version")
                or _setting(settings, "vimax_media_api_version")
                or preset_image["api_version"],
                "model": _setting(settings, "vimax_image_model") or preset_image["model"],
            },
        },
        "video_generator": {
            "__replace__": True,
            "class_path": "tools.VideoGeneratorDoubaoSeedanceDataEyesAPI",
            "init_args": {
                "api_key": api_key,
                "base_url": base_url,
                "api_version": _setting(settings, "vimax_video_api_version") or preset_video["api_version"],
                "t2v_model": _setting(settings, "vimax_video_t2v_model") or preset_video["t2v_model"],
                "ff2v_model": _setting(settings, "vimax_video_ff2v_model") or video_model,
                "flf2v_model": _setting(settings, "vimax_video_flf2v_model") or video_model,
            },
        },
    }


def _dataeyes_gemini_veo_media_preset_override(settings: Any, *, api_key: str) -> dict[str, Any]:
    preset = vimax_media_preset(DATAEYES_GEMINI_VEO_MEDIA_PRESET)
    preset_image = preset["image"]
    preset_video = preset["video"]
    base_url = _versionless_media_base_url(_setting(settings, "vimax_media_base_url") or DEFAULT_DATAEYES_MEDIA_BASE_URL)
    video_model = _setting(settings, "vimax_video_model") or preset_video["model"]
    return {
        "image_generator": {
            "__replace__": True,
            "class_path": "tools.ImageGeneratorNanobananaDataEyesAPI",
            "init_args": {
                "api_key": api_key,
                "base_url": base_url,
                "api_version": _setting(settings, "vimax_image_api_version")
                or _setting(settings, "vimax_media_api_version")
                or preset_image["api_version"],
                "model": _setting(settings, "vimax_image_model") or preset_image["model"],
            },
        },
        "video_generator": {
            "__replace__": True,
            "class_path": "tools.VideoGeneratorVeoDataEyesAPI",
            "init_args": {
                "api_key": api_key,
                "base_url": base_url,
                "api_version": _setting(settings, "vimax_video_api_version") or preset_video["api_version"],
                "t2v_model": _setting(settings, "vimax_video_t2v_model") or preset_video["t2v_model"],
                "ff2v_model": _setting(settings, "vimax_video_ff2v_model") or video_model,
                "flf2v_model": _setting(settings, "vimax_video_flf2v_model") or video_model,
            },
        },
    }


def _media_api_key(settings: Any, *, provider_id: str, media_provider: str) -> str:
    explicit_media_key = _setting(settings, "vimax_media_api_key")
    if explicit_media_key:
        return explicit_media_key

    if media_provider == "google":
        return _setting(settings, "vimax_google_api_key") or _setting(settings, "google_api_key")

    if media_provider == "yunwu":
        return _setting(settings, "vimax_yunwu_api_key") or _custom_endpoint_api_key(
            settings,
            endpoint_id=provider_id if provider_id.startswith("custom_") else "",
            base_url_markers=YUNWU_BASE_URL_MARKERS,
        )

    if media_provider == "dataeyes":
        return _custom_endpoint_api_key(
            settings,
            endpoint_id=provider_id if provider_id.startswith("custom_") else "",
            base_url_markers=DATAEYES_BASE_URL_MARKERS,
        )

    return (
        _setting(settings, "vimax_google_api_key")
        or _setting(settings, "vimax_yunwu_api_key")
        or _setting(settings, "google_api_key")
        or _custom_endpoint_api_key(settings, endpoint_id=provider_id if provider_id.startswith("custom_") else "")
        or _custom_endpoint_api_key(settings, base_url_markers=YUNWU_BASE_URL_MARKERS)
        or _custom_endpoint_api_key(settings, base_url_markers=DATAEYES_BASE_URL_MARKERS)
    )


def _custom_endpoint_api_key(
    settings: Any,
    *,
    endpoint_id: str = "",
    base_url_markers: tuple[str, ...] = (),
) -> str:
    candidates = []
    for endpoint in get_custom_endpoints(settings):
        if endpoint_id and endpoint.get("id") != endpoint_id:
            continue
        base_url = str(endpoint.get("base_url") or "").lower()
        if base_url_markers and not any(marker in base_url for marker in base_url_markers):
            continue
        candidates.append(endpoint)

    # Prefer endpoints enabled for normal WorkCraft use, but allow a saved
    # endpoint as a ViMax credential fallback because rendering is explicit.
    for endpoint in [*filter(lambda item: item.get("enabled", True), candidates), *candidates]:
        api_key = str(endpoint.get("api_key") or "").strip()
        if api_key:
            return api_key
    return ""


def _setting(settings: Any, name: str) -> str:
    return str(getattr(settings, name, "") or "").strip()


def _chat_model_override(provider_id: str, model_id: str, settings: Any) -> dict[str, Any]:
    if not provider_id:
        return {}

    if provider_id.startswith("custom_"):
        for endpoint in get_custom_endpoints(settings):
            if endpoint.get("id") != provider_id:
                continue
            return {
                "model": model_id,
                "model_provider": "openai",
                "api_key": endpoint.get("api_key", ""),
                "base_url": endpoint.get("base_url", ""),
            }
        return {}

    provider_def = PROVIDER_CATALOG.get(provider_id)
    if provider_def is None:
        return {}

    if provider_id == "openrouter" and model_id.startswith("workcraft/"):
        model_id = "openrouter/free"

    api_key = str(getattr(settings, provider_def.settings_key, "") or "")
    if not api_key:
        return {}

    base_url = provider_def.base_url
    if provider_id == "azure":
        base_url = str(getattr(settings, "azure_openai_base_url", "") or "")
    if provider_id == "openrouter":
        base_url = "https://openrouter.ai/api/v1"

    if provider_def.kind == "native_gemini":
        return {
            "model": model_id,
            "model_provider": "google_genai",
            "api_key": api_key,
        }

    return {
        "model": model_id,
        "model_provider": "openai",
        "api_key": api_key,
        "base_url": base_url,
    }


def _workcraft_task_metadata(ctx: ToolContext, *, resume_task_id: str = "") -> dict[str, Any]:
    metadata = {
        "session_id": ctx.session_id,
        "message_id": ctx.message_id,
        "call_id": ctx.call_id,
        "agent": getattr(ctx.agent, "name", ""),
        "provider_id": str(getattr(ctx, "_provider_id", "") or ""),
        "model_id": str(getattr(ctx, "_model_id", "") or ""),
    }
    if resume_task_id:
        metadata["resume_task_id"] = resume_task_id
    return {"workcraft": {key: value for key, value in metadata.items() if value not in (None, "")}}


async def _record_task_status(
    ctx: ToolContext,
    input_args: dict[str, Any],
    status: dict[str, Any],
    *,
    tool_id: str,
) -> None:
    app_state = getattr(ctx, "_app_state", None)
    if not isinstance(app_state, dict):
        return
    session_factory = app_state.get("session_factory")
    if not callable(session_factory):
        return

    metadata = status.get("metadata") if isinstance(status.get("metadata"), dict) else {}
    workcraft = metadata.get("workcraft") if isinstance(metadata.get("workcraft"), dict) else {}
    task_id = str(status.get("task_id") or workcraft.get("resume_task_id") or "").strip()
    if not task_id:
        return

    action = str(input_args.get("action") or "submit").lower()
    payload = None
    if action in {"submit", "resume"} or any(key in input_args for key in ("script", "idea")):
        payload = redact_sensitive_payload(_deep_merge({}, input_args))

    try:
        async with session_factory() as db:
            async with db.begin():
                await upsert_vimax_task_run(
                    db,
                    session_id=str(workcraft.get("session_id") or ctx.session_id),
                    message_id=str(workcraft.get("message_id") or ctx.message_id),
                    call_id=str(workcraft.get("call_id") or ctx.call_id),
                    task_id=task_id,
                    tool_id=tool_id,
                    mode=str(status.get("mode") or input_args.get("mode") or "script2video"),
                    status=str(status.get("status") or "queued"),
                    stage=str(status.get("stage") or "queued"),
                    working_dir=str(status.get("working_dir") or ""),
                    final_video_path=str(status.get("final_video_path") or "") or None,
                    error_message=str(status.get("error") or "") or None,
                    input_payload=payload,
                    runtime_status=_public_status(status),
                )
                await _sync_vimax_tool_part_status(
                    db,
                    session_id=str(workcraft.get("session_id") or ctx.session_id),
                    message_id=str(workcraft.get("message_id") or ctx.message_id),
                    call_id=str(workcraft.get("call_id") or ctx.call_id),
                    task_id=task_id,
                    input_args=input_args,
                    status=status,
                )
    except Exception:
        logger.debug("Failed to persist ViMax task status for %s", task_id, exc_info=True)


async def _sync_vimax_tool_part_status(
    db,
    *,
    session_id: str,
    message_id: str,
    call_id: str,
    task_id: str,
    input_args: dict[str, Any],
    status: dict[str, Any],
) -> None:
    if not message_id:
        return
    result = await db.execute(
        select(Part)
        .where(Part.session_id == session_id)
        .where(Part.message_id == message_id)
        .where(Part.data["type"].as_string() == "tool")
        .where(Part.data["tool"].as_string() == "vimax_generate_video")
    )
    fallback: Part | None = None
    target: Part | None = None
    for part in result.scalars().all():
        data = part.data if isinstance(part.data, dict) else {}
        state = data.get("state") if isinstance(data.get("state"), dict) else {}
        metadata = state.get("metadata") if isinstance(state.get("metadata"), dict) else {}
        if data.get("call_id") == call_id:
            target = part
            break
        if metadata.get("task_id") == task_id:
            fallback = part
    part = target or fallback
    if part is None:
        return

    data = part.data if isinstance(part.data, dict) else {}
    state = data.get("state") if isinstance(data.get("state"), dict) else {}
    runtime_state = str(status.get("status") or "queued")
    tool_status = "completed" if runtime_state == "completed" else "error" if runtime_state in {"failed", "cancelled", "stale"} else "running"
    metadata = _status_metadata(status)
    artifact_index = _collect_artifacts(status)
    if artifact_index.get("items"):
        metadata["vimax_artifacts"] = artifact_index
    final_video = artifact_index.get("final_video")
    if final_video:
        metadata["file_path"] = final_video.get("path")
        metadata["title"] = final_video.get("name")
    output = _compact_progress_output(status, metadata)
    part.data = {
        "type": "tool",
        "tool": "vimax_generate_video",
        "call_id": str(data.get("call_id") or call_id),
        "state": {
            "status": tool_status,
            "input": state.get("input") if isinstance(state.get("input"), dict) else {key: value for key, value in input_args.items() if key != "action"},
            "output": output,
            "metadata": metadata,
            "title": _tool_title_for_status(status, task_id),
            "time_start": state.get("time_start"),
            "time_end": None if tool_status == "running" else _now_iso(),
            "time_compacted": state.get("time_compacted"),
        },
    }


def _compact_progress_output(status: dict[str, Any], metadata: dict[str, Any]) -> str:
    runtime_state = str(status.get("status") or "")
    if runtime_state in {"failed", "cancelled", "stale"}:
        message = str(metadata.get("message") or status.get("message") or "").strip()
        stage = str(metadata.get("stage") or status.get("stage") or runtime_state).strip()
        if message:
            return f"{stage}: {message}" if stage and stage != runtime_state else message

    steps = metadata.get("vimax_steps") if isinstance(metadata.get("vimax_steps"), list) else []
    current = next((step for step in reversed(steps) if isinstance(step, dict) and step.get("status") == "running"), None)
    if current:
        title = str(current.get("title") or current.get("key") or "ViMax")
        progress = current.get("progress")
        pct = f"{round(float(progress) * 100)}%" if isinstance(progress, (int, float)) else ""
        message = str(current.get("message") or metadata.get("message") or "")
        return " · ".join(part for part in [title, pct, message] if part)
    message = str(metadata.get("message") or "")
    stage = str(metadata.get("stage") or "")
    progress = metadata.get("progress")
    pct = f"{round(float(progress) * 100)}%" if isinstance(progress, (int, float)) else ""
    return " · ".join(part for part in [stage, pct, message] if part) or json.dumps(_public_status(status), ensure_ascii=False)


def _tool_title_for_status(status: dict[str, Any], task_id: str) -> str:
    state = str(status.get("status") or "")
    if state == "completed":
        return f"ViMax video: {task_id}"
    if state in {"failed", "cancelled", "stale"}:
        return f"ViMax {state}: {task_id}"
    return f"ViMax rendering: {task_id}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def query_and_record_vimax_status(
    *,
    runtime_url: str,
    task_id: str,
    ctx: ToolContext,
) -> ToolResult:
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=60.0)) as client:
        return await ViMaxGenerateVideoTool()._status(client, runtime_url.rstrip("/"), task_id, ctx=ctx)


async def _find_resume_task(ctx: ToolContext, *, task_id: str = "") -> dict[str, Any] | None:
    app_state = getattr(ctx, "_app_state", None)
    if not isinstance(app_state, dict):
        return None
    session_factory = app_state.get("session_factory")
    if not callable(session_factory):
        return None

    try:
        async with session_factory() as db:
            if task_id:
                record = await get_vimax_task_run(db, task_id)
                if record and record.session_id == ctx.session_id:
                    return {
                        "task_id": record.task_id,
                        "input": dict(record.input_payload or {}),
                    }
                return None

            record = await get_latest_vimax_task_run_for_session(db, ctx.session_id)
            if record is None:
                return None
            return {
                "task_id": record.task_id,
                "input": dict(record.input_payload or {}),
            }
    except Exception:
        logger.debug("Failed to look up persisted ViMax task for session %s", ctx.session_id, exc_info=True)
        return None


async def _latest_session_task(ctx: ToolContext) -> dict[str, Any] | None:
    app_state = getattr(ctx, "_app_state", None)
    if isinstance(app_state, dict):
        runtime_url = ""
        settings = get_settings(ctx)
        runtime_url = str(settings.vimax_runtime_url or "").rstrip("/")
        session_factory = app_state.get("session_factory")
        if callable(session_factory) and runtime_url:
            task = await _find_resume_task(ctx)
            if task:
                return task
            async with session_factory() as db:
                result = await db.execute(
                    select(Part)
                    .where(Part.session_id == ctx.session_id)
                    .order_by(Part.time_created.desc())
                    .limit(100)
                )
                parts = list(result.scalars().all())

            for part in parts:
                data = part.data or {}
                if data.get("type") != "tool" or data.get("tool") != "vimax_generate_video":
                    continue
                state = data.get("state") if isinstance(data.get("state"), dict) else {}
                metadata = state.get("metadata") if isinstance(state.get("metadata"), dict) else {}
                task_id = str(metadata.get("task_id") or "").strip()
                if not task_id:
                    continue
                input_args = state.get("input") if isinstance(state.get("input"), dict) else {}
                return {"task_id": task_id, "input": {key: value for key, value in input_args.items() if key != "action"}}
    return None


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result
