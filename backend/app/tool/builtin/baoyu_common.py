"""Shared helpers for wrapping baoyu-skills scripts."""

from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from app.config import get_settings
from app.tool.context import ToolContext
from app.tool.subprocess_compat import decode_subprocess_output, get_subprocess_kwargs
from app.tool.workspace import WorkspaceViolation, resolve_and_validate, resolve_for_write
from app.utils.id import generate_ulid


BAOYU_PLUGIN_DIR = Path(__file__).resolve().parents[3] / "app" / "data" / "plugins" / "baoyu-skills"
MAX_CAPTURED_OUTPUT_CHARS = 12000


@dataclass
class BaoyuCommandResult:
    args: list[str]
    cwd: str
    exit_code: int
    stdout: str
    stderr: str


def baoyu_plugin_root() -> Path:
    if BAOYU_PLUGIN_DIR.exists():
        return BAOYU_PLUGIN_DIR
    raise FileNotFoundError(f"baoyu-skills plugin not found: {BAOYU_PLUGIN_DIR}")


def baoyu_skill_dir(skill_name: str) -> Path:
    path = baoyu_plugin_root() / "skills" / skill_name
    if not path.exists():
        raise FileNotFoundError(f"baoyu skill not found: {skill_name}")
    return path


def resolve_bun_command() -> list[str]:
    bun = shutil.which("bun")
    if bun:
        return [bun]
    npx = shutil.which("npx")
    if npx:
        return [npx, "-y", "bun"]
    raise FileNotFoundError("Bun runtime not found. Install bun, or make npx available so WorkCraft can run npx -y bun.")


def workspace_dir(ctx: ToolContext) -> Path:
    return Path(ctx.workspace or ".").resolve()


def baoyu_command_cwd(ctx: ToolContext, skill_name: str) -> Path:
    """Return the cwd that gives baoyu scripts the best chance to find config."""
    workspace = workspace_dir(ctx)
    candidates = [
        workspace,
        workspace / "backend",
        Path.cwd().resolve(),
        Path.cwd().resolve() / "backend",
    ]
    seen: set[str] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        if (resolved / ".baoyu-skills" / skill_name / "EXTEND.md").exists():
            return resolved
        if (resolved / ".baoyu-skills" / ".env").exists():
            return resolved
    return workspace


def output_base_dir(ctx: ToolContext) -> Path:
    return workspace_dir(ctx) / "workcraft_written"


def resolve_output_path(path_value: str, ctx: ToolContext, *, default_relative: str) -> str:
    value = str(path_value or "").strip() or default_relative
    return resolve_for_write(value, ctx.workspace)


def resolve_input_path(path_value: str, ctx: ToolContext) -> str:
    if not str(path_value or "").strip():
        raise ValueError("Input path is required.")
    raw_path = Path(path_value).expanduser()
    if ctx.workspace and not raw_path.is_absolute():
        workspace = workspace_dir(ctx)
        written_candidate = (workspace / "workcraft_written" / raw_path).resolve()
        if written_candidate.exists():
            return str(written_candidate)
    try:
        return resolve_and_validate(path_value, ctx.workspace)
    except WorkspaceViolation:
        resolved = str(Path(path_value).expanduser().resolve())
        if resolved in getattr(ctx, "allowed_file_paths", set()):
            return resolved
        raise


def resolve_optional_input_path(path_value: Any, ctx: ToolContext) -> str | None:
    if not isinstance(path_value, str) or not path_value.strip():
        return None
    return resolve_input_path(path_value, ctx)


def resolve_repeated_input_paths(values: Any, ctx: ToolContext) -> list[str]:
    if not isinstance(values, list):
        return []
    paths: list[str] = []
    for value in values:
        if isinstance(value, str) and value.strip():
            paths.append(resolve_input_path(value, ctx))
    return paths


def baoyu_subprocess_env() -> dict[str, str]:
    settings = get_settings()
    env = dict(os.environ)

    custom_openai = _custom_openai_endpoint(settings)
    if custom_openai is not None:
        base_url, api_key = custom_openai
        _set_if_present(env, "OPENAI_API_KEY", api_key)
        _set_if_present(env, "OPENAI_BASE_URL", base_url)
    else:
        _set_if_present(env, "OPENAI_API_KEY", settings.openai_api_key)
        _set_if_present(env, "OPENAI_BASE_URL", settings.openai_base_url)
    _set_if_missing(env, "OPENROUTER_API_KEY", settings.openrouter_api_key)
    _set_if_missing(env, "GOOGLE_API_KEY", settings.google_api_key)
    _set_if_missing(env, "GEMINI_API_KEY", settings.google_api_key)
    _set_if_missing(env, "AZURE_OPENAI_API_KEY", settings.azure_openai_api_key)
    _set_if_missing(env, "AZURE_OPENAI_BASE_URL", settings.azure_openai_base_url)
    _set_if_missing(env, "DASHSCOPE_API_KEY", settings.qwen_api_key)
    _set_if_missing(env, "MINIMAX_API_KEY", settings.minimax_api_key)
    _set_if_missing(env, "ZAI_API_KEY", settings.zhipu_api_key)
    _set_if_missing(env, "BIGMODEL_API_KEY", settings.zhipu_api_key)
    return env


def _set_if_missing(env: dict[str, str], key: str, value: str | None) -> None:
    if value and not env.get(key):
        env[key] = value


def _set_if_present(env: dict[str, str], key: str, value: str | None) -> None:
    if value:
        env[key] = value


def _custom_openai_endpoint(settings: Any) -> tuple[str, str] | None:
    try:
        from app.config import get_custom_endpoints

        endpoints = get_custom_endpoints(settings)
    except Exception:
        return None

    candidates: list[dict[str, Any]] = []
    for endpoint in endpoints:
        if not isinstance(endpoint, dict):
            continue

        base_url = endpoint.get("base_url") or endpoint.get("url") or ""
        api_key = endpoint.get("api_key") or endpoint.get("key") or ""
        if not base_url or not api_key:
            continue

        endpoint_id = str(endpoint.get("id") or "").lower()
        name = str(endpoint.get("name") or "").lower()
        if endpoint_id.startswith("custom_") or "openai" in name or "aihub" in str(base_url).lower():
            candidates.append(endpoint)

    # Prefer endpoints enabled for normal chat, but allow a saved custom endpoint
    # as an explicit Baoyu image/publish credential fallback.
    for endpoint in [*filter(lambda item: item.get("enabled", True), candidates), *candidates]:
        base_url = endpoint.get("base_url") or endpoint.get("url") or ""
        api_key = endpoint.get("api_key") or endpoint.get("key") or ""
        if base_url and api_key:
            return str(base_url).rstrip("/"), str(api_key)

    return None


async def run_baoyu_command(
    args: Sequence[str],
    *,
    cwd: str | Path,
    timeout: int,
    env: dict[str, str] | None = None,
) -> BaoyuCommandResult:
    command = [str(arg) for arg in args]
    extra_kwargs = get_subprocess_kwargs()

    def _run() -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(cwd),
            timeout=timeout,
            env=env or baoyu_subprocess_env(),
            **extra_kwargs,
        )

    result = await asyncio.to_thread(_run)
    return BaoyuCommandResult(
        args=command,
        cwd=str(cwd),
        exit_code=result.returncode,
        stdout=decode_subprocess_output(result.stdout),
        stderr=decode_subprocess_output(result.stderr),
    )


def parse_json_from_stdout(stdout: str) -> dict[str, Any] | None:
    text = stdout.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def command_output(result: BaoyuCommandResult) -> str:
    parts = [
        f"Command: {redact_command(result.args)}",
        f"Cwd: {result.cwd}",
        f"Exit code: {result.exit_code}",
    ]
    stdout = _clip(result.stdout.strip())
    stderr = _clip(result.stderr.strip())
    if stdout:
        parts.extend(["", "STDOUT:", stdout])
    if stderr:
        parts.extend(["", "STDERR:", stderr])
    if not stdout and not stderr:
        parts.append("\n(no output)")
    return "\n".join(parts)


def redact_command(args: Sequence[str]) -> str:
    redacted: list[str] = []
    secret_flags = {
        "--remote-identity-file",
    }
    skip_next = False
    for index, arg in enumerate(args):
        if skip_next:
            redacted.append("***")
            skip_next = False
            continue
        redacted.append(arg)
        if arg in secret_flags and index < len(args) - 1:
            skip_next = True
    return " ".join(shlex_quote(part) for part in redacted)


def shlex_quote(value: str) -> str:
    import shlex

    return shlex.quote(value)


def attachment_for_path(path_value: str) -> dict[str, Any] | None:
    path = Path(path_value)
    if not path.exists() or not path.is_file():
        return None
    mime_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return {
        "file_id": generate_ulid(),
        "path": str(path.resolve()),
        "name": path.name,
        "size": path.stat().st_size,
        "mime_type": mime_type,
        "source": "referenced",
    }


def _clip(text: str) -> str:
    if len(text) <= MAX_CAPTURED_OUTPUT_CHARS:
        return text
    return text[:MAX_CAPTURED_OUTPUT_CHARS] + f"\n... [truncated at {MAX_CAPTURED_OUTPUT_CHARS} chars]"
