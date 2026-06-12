"""Tests for WorkCraft's native baoyu wrappers."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from app.schemas.agent import AgentInfo
from app.tool.builtin.baoyu_common import (
    BaoyuCommandResult,
    baoyu_command_cwd,
    baoyu_subprocess_env,
    resolve_input_path,
)
from app.tool.builtin.baoyu_image_generate import BaoyuImageGenerateTool
from app.tool.builtin.baoyu_publish import BaoyuPublishTool
from app.tool.context import ToolContext


def _ctx(workspace: Path) -> ToolContext:
    return ToolContext(
        session_id="test-session",
        message_id="test-message",
        agent=AgentInfo(name="test", description="", mode="primary"),
        call_id="test-call",
        workspace=str(workspace),
    )


def _cmd(exit_code: int = 0, stdout: str = "", stderr: str = "") -> BaoyuCommandResult:
    return BaoyuCommandResult(
        args=["bun", "script.ts"],
        cwd="/tmp/workspace",
        exit_code=exit_code,
        stdout=stdout,
        stderr=stderr,
    )


def test_baoyu_command_cwd_prefers_backend_config(tmp_path: Path) -> None:
    workspace = tmp_path
    config = workspace / "backend" / ".baoyu-skills" / "baoyu-post-to-wechat" / "EXTEND.md"
    config.parent.mkdir(parents=True)
    config.write_text("default_publish_method: browser\n", encoding="utf-8")

    assert baoyu_command_cwd(_ctx(workspace), "baoyu-post-to-wechat") == workspace / "backend"


def test_resolve_input_path_checks_workcraft_written_first(tmp_path: Path) -> None:
    target = tmp_path / "workcraft_written" / "content-output" / "article.md"
    target.parent.mkdir(parents=True)
    target.write_text("# Article\n", encoding="utf-8")

    assert resolve_input_path("content-output/article.md", _ctx(tmp_path)) == str(target.resolve())


def test_baoyu_subprocess_env_passes_workcraft_openai_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Settings:
        openai_api_key = "workcraft-openai-key"
        openai_base_url = "https://aihub2.top/v1"
        openrouter_api_key = ""
        google_api_key = ""
        azure_openai_api_key = ""
        azure_openai_base_url = ""
        qwen_api_key = ""
        minimax_api_key = ""
        zhipu_api_key = ""

    monkeypatch.setenv("OPENAI_API_KEY", "old-openai-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://old.example/v1")
    custom_endpoints = [
        {
            "id": "custom_e77f397a",
            "name": "自定义端点",
            "base_url": "https://yunwu.ai/v1",
            "api_key": "custom-openai-key",
            "enabled": True,
        }
    ]
    with (
        patch("app.tool.builtin.baoyu_common.get_settings", return_value=_Settings()),
        patch("app.config.get_custom_endpoints", return_value=custom_endpoints),
    ):
        env = baoyu_subprocess_env()

    assert env["OPENAI_API_KEY"] == "custom-openai-key"
    assert env["OPENAI_BASE_URL"] == "https://yunwu.ai/v1"


def test_baoyu_subprocess_env_can_use_disabled_custom_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Settings:
        openai_api_key = "workcraft-openai-key"
        openai_base_url = "https://aihub2.top/v1"
        openrouter_api_key = ""
        google_api_key = ""
        azure_openai_api_key = ""
        azure_openai_base_url = ""
        qwen_api_key = ""
        minimax_api_key = ""
        zhipu_api_key = ""

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    custom_endpoints = [
        {
            "id": "custom_disabled",
            "name": "自定义端点",
            "base_url": "https://yunwu.ai/v1",
            "api_key": "disabled-custom-key",
            "enabled": False,
        }
    ]
    with (
        patch("app.tool.builtin.baoyu_common.get_settings", return_value=_Settings()),
        patch("app.config.get_custom_endpoints", return_value=custom_endpoints),
    ):
        env = baoyu_subprocess_env()

    assert env["OPENAI_API_KEY"] == "disabled-custom-key"
    assert env["OPENAI_BASE_URL"] == "https://yunwu.ai/v1"


def test_image_command_defaults_to_openai_gpt_image_2(tmp_path: Path) -> None:
    tool = BaoyuImageGenerateTool()
    skill_dir = tmp_path / "skill"
    ctx = _ctx(tmp_path)

    with patch("app.tool.builtin.baoyu_image_generate.resolve_bun_command", return_value=["bun"]):
        command = tool._build_command(
            {
                "prompt": "A clean editorial cover",
                "output_path": "visual-assets/cover.png",
                "aspect_ratio": "16:9",
            },
            ctx,
            skill_dir,
        )

    assert command[:2] == ["bun", str(skill_dir / "scripts" / "main.ts")]
    assert command[command.index("--provider") + 1] == "openai"
    assert command[command.index("--model") + 1] == "gpt-image-2"
    assert command[command.index("--ar") + 1] == "16:9"
    assert command[-1] == "--json"
    assert str(tmp_path / "workcraft_written" / "visual-assets" / "cover.png") in command


def test_image_command_groups_reference_images_after_one_ref_flag(tmp_path: Path) -> None:
    ref1 = tmp_path / "ref1.png"
    ref2 = tmp_path / "ref2.png"
    ref1.write_bytes(b"png")
    ref2.write_bytes(b"png")
    tool = BaoyuImageGenerateTool()

    with patch("app.tool.builtin.baoyu_image_generate.resolve_bun_command", return_value=["bun"]):
        command = tool._build_command(
            {
                "prompt": "Keep the same person",
                "output_path": "out.png",
                "reference_images": ["ref1.png", "ref2.png"],
            },
            _ctx(tmp_path),
            tmp_path / "skill",
        )

    ref_index = command.index("--ref")
    assert command[ref_index + 1: ref_index + 3] == [str(ref1.resolve()), str(ref2.resolve())]
    assert command.count("--ref") == 1


@pytest.mark.asyncio
async def test_image_generate_metadata_includes_generated_files(tmp_path: Path) -> None:
    image_path = tmp_path / "workcraft_written" / "visual-assets" / "cover.png"
    image_path.parent.mkdir(parents=True)
    image_path.write_bytes(b"png")
    stdout = f'{{"savedImage":"{image_path}"}}'
    tool = BaoyuImageGenerateTool()

    with (
        patch("app.tool.builtin.baoyu_image_generate.resolve_bun_command", return_value=["bun"]),
        patch("app.tool.builtin.baoyu_image_generate.baoyu_skill_dir", return_value=tmp_path / "skill"),
        patch("app.tool.builtin.baoyu_image_generate.run_baoyu_command", return_value=_cmd(stdout=stdout)),
    ):
        result = await tool.execute(
            {"prompt": "cover", "output_path": "visual-assets/cover.png"},
            _ctx(tmp_path),
        )

    assert result.success
    assert result.attachments
    attachment = result.attachments[0]
    assert attachment["file_id"]
    assert attachment["path"] == str(image_path.resolve())
    assert result.metadata["generated_files"] == result.attachments
    assert result.metadata["attachments"] == result.attachments
    assert result.metadata["generated_images"] == [str(image_path.resolve())]


def test_wechat_api_command_uses_dry_run_without_submit(tmp_path: Path) -> None:
    article = tmp_path / "article.md"
    cover = tmp_path / "cover.png"
    article.write_text("# Hello\n", encoding="utf-8")
    cover.write_bytes(b"png")
    tool = BaoyuPublishTool()

    with patch("app.tool.builtin.baoyu_publish.resolve_bun_command", return_value=["bun"]):
        command, expected_status, _ = tool._wechat_command(
            {
                "method": "api",
                "markdown_path": "article.md",
                "cover": "cover.png",
                "theme": "default",
                "title": "Hello",
            },
            _ctx(tmp_path),
        )

    assert "wechat-api.ts" in command[1]
    assert command[2] == str(article.resolve())
    assert command[command.index("--cover") + 1] == str(cover.resolve())
    assert "--dry-run" in command
    assert expected_status == "dry_run"


def test_wechat_api_command_maps_submit_to_draft_created(tmp_path: Path) -> None:
    article = tmp_path / "article.md"
    article.write_text("# Hello\n", encoding="utf-8")
    tool = BaoyuPublishTool()

    with patch("app.tool.builtin.baoyu_publish.resolve_bun_command", return_value=["bun"]):
        command, expected_status, _ = tool._wechat_command(
            {"method": "api", "markdown_path": "article.md", "submit": True},
            _ctx(tmp_path),
        )

    assert "wechat-api.ts" in command[1]
    assert "--dry-run" not in command
    assert expected_status == "draft_created"


def test_wechat_auto_method_reads_extend_config(tmp_path: Path) -> None:
    article = tmp_path / "article.md"
    article.write_text("# Hello\n", encoding="utf-8")
    config = tmp_path / ".baoyu-skills" / "baoyu-post-to-wechat" / "EXTEND.md"
    config.parent.mkdir(parents=True)
    config.write_text("default_publish_method: api\n", encoding="utf-8")
    tool = BaoyuPublishTool()

    with patch("app.tool.builtin.baoyu_publish.resolve_bun_command", return_value=["bun"]):
        command, expected_status, _ = tool._wechat_command(
            {"method": "auto", "markdown_path": "article.md", "submit": True},
            _ctx(tmp_path),
        )

    assert "wechat-api.ts" in command[1]
    assert expected_status == "draft_created"


def test_weibo_publish_is_composed_pending_user(tmp_path: Path) -> None:
    tool = BaoyuPublishTool()

    with patch("app.tool.builtin.baoyu_publish.resolve_bun_command", return_value=["bun"]):
        command, expected_status, _ = tool._weibo_command(
            {"kind": "post", "text": "hello"},
            _ctx(tmp_path),
        )

    assert "weibo-post.ts" in command[1]
    assert "--submit" not in command
    assert expected_status == "composed_pending_user"


def test_x_submit_maps_to_published(tmp_path: Path) -> None:
    tool = BaoyuPublishTool()

    with patch("app.tool.builtin.baoyu_publish.resolve_bun_command", return_value=["bun"]):
        command, expected_status, _ = tool._x_command(
            {"kind": "post", "text": "hello", "submit": True},
            _ctx(tmp_path),
        )

    assert "x-browser.ts" in command[1]
    assert command[-1] == "--submit"
    assert expected_status == "published"


@pytest.mark.asyncio
async def test_publish_parses_wechat_json_status(tmp_path: Path) -> None:
    article = tmp_path / "article.md"
    article.write_text("# Hello\n", encoding="utf-8")
    tool = BaoyuPublishTool()
    stdout = '{"success":true,"media_id":"MEDIA","title":"Hello","articleType":"news","method":"api"}'

    with (
        patch("app.tool.builtin.baoyu_publish.resolve_bun_command", return_value=["bun"]),
        patch("app.tool.builtin.baoyu_publish.run_baoyu_command", return_value=_cmd(stdout=stdout)),
    ):
        result = await tool.execute(
            {"platform": "wechat", "method": "api", "markdown_path": "article.md", "submit": True},
            _ctx(tmp_path),
        )

    assert result.success
    assert result.metadata["status"] == "draft_created"
    assert result.metadata["media_id"] == "MEDIA"
    assert result.metadata["publicly_visible"] is False
