"""Native WorkCraft wrapper for baoyu-image-gen."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from app.tool.base import ToolDefinition, ToolResult
from app.tool.builtin.baoyu_common import (
    attachment_for_path,
    baoyu_command_cwd,
    baoyu_skill_dir,
    baoyu_subprocess_env,
    command_output,
    parse_json_from_stdout,
    resolve_bun_command,
    resolve_input_path,
    resolve_output_path,
    run_baoyu_command,
)
from app.tool.context import ToolContext


DEFAULT_TIMEOUT_SECONDS = 900


class BaoyuImageGenerateTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "baoyu_image_generate"

    @property
    def description(self) -> str:
        return (
            "Generate images through the bundled baoyu-image-gen skill scripts. "
            "Use this for real image generation in the 宝玉内容工坊. Defaults to "
            "provider='openai' and model='gpt-image-2'. Returns saved image paths "
            "and attaches generated files when available."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Image prompt for single-image mode.",
                },
                "output_path": {
                    "type": "string",
                    "description": "Output image path. Relative paths are written under workcraft_written/.",
                },
                "provider": {
                    "type": "string",
                    "enum": [
                        "google",
                        "openai",
                        "azure",
                        "openrouter",
                        "dashscope",
                        "zai",
                        "minimax",
                        "jimeng",
                        "seedream",
                        "replicate",
                        "codex-cli",
                    ],
                    "description": "Image provider. Defaults to openai.",
                    "default": "openai",
                },
                "model": {
                    "type": "string",
                    "description": "Image model. Defaults to gpt-image-2 for OpenAI.",
                    "default": "gpt-image-2",
                },
                "aspect_ratio": {
                    "type": "string",
                    "description": "Aspect ratio such as 1:1, 16:9, 9:16, 4:3.",
                },
                "size": {
                    "type": "string",
                    "description": "Explicit output size such as 2048x2048 or 3840x2160.",
                },
                "quality": {
                    "type": "string",
                    "enum": ["normal", "2k"],
                    "description": "baoyu quality preset. Defaults to 2k.",
                    "default": "2k",
                },
                "image_size": {
                    "type": "string",
                    "enum": ["1K", "2K", "4K"],
                    "description": "Provider-specific image size for Google/OpenRouter.",
                },
                "image_api_dialect": {
                    "type": "string",
                    "enum": ["openai-native", "ratio-metadata"],
                    "description": "OpenAI-compatible image API dialect.",
                },
                "reference_images": {
                    "type": "array",
                    "description": "Reference image paths. Relative paths are resolved against the workspace.",
                    "items": {"type": "string"},
                },
                "n": {
                    "type": "integer",
                    "description": "Number of images requested from the provider for this task.",
                    "default": 1,
                },
                "batch_file": {
                    "type": "string",
                    "description": "Optional baoyu-image-gen batch JSON file.",
                },
                "jobs": {
                    "type": "integer",
                    "description": "Batch worker count.",
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": "Subprocess timeout. Defaults to 900 seconds.",
                    "default": DEFAULT_TIMEOUT_SECONDS,
                },
            },
            "required": [],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        skill_dir = baoyu_skill_dir("baoyu-image-gen")
        command = self._build_command(args, ctx, skill_dir)
        timeout = int(args.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS)

        ctx.publish_metadata(
            title="baoyu image generation",
            metadata={"provider": args.get("provider") or "openai", "model": args.get("model") or "gpt-image-2"},
        )

        result = await run_baoyu_command(
            command,
            cwd=baoyu_command_cwd(ctx, "baoyu-image-gen"),
            timeout=timeout,
            env=baoyu_subprocess_env(),
        )
        payload = parse_json_from_stdout(result.stdout)
        metadata = {
            "status": "failed" if result.exit_code else "generated",
            "exit_code": result.exit_code,
            "command": result.args,
            "cwd": result.cwd,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "baoyu_json": payload,
        }

        image_paths = _image_paths_from_payload(payload)
        if not image_paths:
            output_path = args.get("output_path")
            if isinstance(output_path, str) and output_path.strip():
                image_paths = [resolve_output_path(output_path, ctx, default_relative=_default_image_path())]

        attachments = [
            attachment
            for path in image_paths
            if (attachment := attachment_for_path(path)) is not None
        ]
        if attachments:
            metadata["file_path"] = attachments[0]["path"]
            metadata["title"] = attachments[0]["name"]
            metadata["generated_images"] = [attachment["path"] for attachment in attachments]
            metadata["generated_files"] = attachments
            metadata["attachments"] = attachments

        output = command_output(result)
        if payload:
            output += "\n\nParsed result:\n" + json.dumps(payload, ensure_ascii=False, indent=2)
        if attachments:
            output += "\n\nGenerated files:\n" + "\n".join(f"- {item['path']}" for item in attachments)

        if result.exit_code != 0:
            return ToolResult(
                error=output,
                title="baoyu image generation failed",
                metadata={**metadata, "blocking_error": True},
                attachments=attachments,
            )

        return ToolResult(
            output=output,
            title="baoyu image generated",
            metadata=metadata,
            attachments=attachments,
        )

    def _build_command(self, args: dict[str, Any], ctx: ToolContext, skill_dir: Path) -> list[str]:
        command = [*resolve_bun_command(), str(skill_dir / "scripts" / "main.ts")]

        batch_file = args.get("batch_file")
        if isinstance(batch_file, str) and batch_file.strip():
            command.extend(["--batchfile", resolve_input_path(batch_file, ctx)])
            if jobs := args.get("jobs"):
                command.extend(["--jobs", str(jobs)])
            command.append("--json")
            return command

        prompt = str(args.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("prompt is required unless batch_file is provided.")
        output_path = resolve_output_path(
            str(args.get("output_path") or ""),
            ctx,
            default_relative=_default_image_path(),
        )

        command.extend(["--prompt", prompt, "--image", output_path])
        command.extend(["--provider", str(args.get("provider") or "openai")])
        command.extend(["--model", str(args.get("model") or "gpt-image-2")])
        command.extend(["--quality", str(args.get("quality") or "2k")])

        if value := _string_arg(args, "aspect_ratio"):
            command.extend(["--ar", value])
        if value := _string_arg(args, "size"):
            command.extend(["--size", value])
        if value := _string_arg(args, "image_size"):
            command.extend(["--imageSize", value])
        if value := _string_arg(args, "image_api_dialect"):
            command.extend(["--imageApiDialect", value])
        reference_images = [
            resolve_input_path(ref, ctx)
            for ref in (args.get("reference_images") or [])
            if isinstance(ref, str) and ref.strip()
        ]
        if reference_images:
            command.append("--ref")
            command.extend(reference_images)
        if n := args.get("n"):
            command.extend(["--n", str(n)])
        command.append("--json")
        return command


def _string_arg(args: dict[str, Any], name: str) -> str | None:
    value = args.get(name)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _default_image_path() -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"visual-assets/baoyu-image-{stamp}.png"


def _image_paths_from_payload(payload: dict[str, Any] | None) -> list[str]:
    if not payload:
        return []
    if isinstance(payload.get("savedImage"), str):
        return [payload["savedImage"]]
    results = payload.get("results")
    if isinstance(results, list):
        paths: list[str] = []
        for item in results:
            if isinstance(item, dict) and item.get("success") and isinstance(item.get("outputPath"), str):
                paths.append(item["outputPath"])
        return paths
    return []
