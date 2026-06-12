"""Native WorkCraft wrapper for baoyu publishing scripts."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from app.tool.base import ToolDefinition, ToolResult
from app.tool.builtin.baoyu_common import (
    baoyu_command_cwd,
    baoyu_skill_dir,
    baoyu_subprocess_env,
    command_output,
    output_base_dir,
    parse_json_from_stdout,
    resolve_bun_command,
    resolve_optional_input_path,
    resolve_repeated_input_paths,
    run_baoyu_command,
)
from app.tool.context import ToolContext


DEFAULT_TIMEOUT_SECONDS = 1200


class BaoyuPublishTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "baoyu_publish"

    @property
    def description(self) -> str:
        return (
            "Execute bundled baoyu-skills publishing scripts for WeChat Official Account, "
            "Weibo, and X/Twitter. This tool performs real script execution and reports "
            "the exact platform state: public published, WeChat draft created, browser "
            "composed pending user confirmation, or failed. Use submit=true only when "
            "the user explicitly requested the final publish/save action."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "platform": {
                    "type": "string",
                    "enum": ["wechat", "weibo", "x"],
                    "description": "Target platform.",
                },
                "kind": {
                    "type": "string",
                    "enum": ["article", "post", "image_text", "video", "quote"],
                    "description": "Content type. Defaults by platform/input when omitted.",
                },
                "method": {
                    "type": "string",
                    "enum": ["auto", "api", "remote-api", "browser", "cdp"],
                    "description": "Publishing method. WeChat supports api, remote-api, browser. Weibo/X wrappers use CDP scripts.",
                    "default": "auto",
                },
                "markdown_path": {
                    "type": "string",
                    "description": "Markdown file path for long-form article publishing.",
                },
                "html_path": {
                    "type": "string",
                    "description": "HTML file path for WeChat article publishing.",
                },
                "text": {
                    "type": "string",
                    "description": "Post text or plain article content.",
                },
                "title": {
                    "type": "string",
                    "description": "Article title override.",
                },
                "summary": {
                    "type": "string",
                    "description": "Article summary/digest override.",
                },
                "author": {
                    "type": "string",
                    "description": "WeChat author override.",
                },
                "cover": {
                    "type": "string",
                    "description": "Cover image path.",
                },
                "images": {
                    "type": "array",
                    "description": "Image paths for regular posts or WeChat image-text posts.",
                    "items": {"type": "string"},
                },
                "images_dir": {
                    "type": "string",
                    "description": "Directory of images for WeChat image-text posts.",
                },
                "video": {
                    "type": "string",
                    "description": "Video path for X or Weibo video posts.",
                },
                "tweet_url": {
                    "type": "string",
                    "description": "Tweet URL for X quote posts.",
                },
                "theme": {
                    "type": "string",
                    "description": "WeChat markdown theme. Defaults to default.",
                    "default": "default",
                },
                "color": {
                    "type": "string",
                    "description": "WeChat theme color preset or hex color.",
                },
                "account": {
                    "type": "string",
                    "description": "WeChat account alias from EXTEND.md.",
                },
                "profile": {
                    "type": "string",
                    "description": "Chrome profile directory for browser/CDP scripts.",
                },
                "submit": {
                    "type": "boolean",
                    "description": "Perform the final supported submit action. WeChat saves a draft; X publicly posts/publishes; Weibo currently ignores final publish because upstream scripts only compose.",
                    "default": False,
                },
                "no_cite": {
                    "type": "boolean",
                    "description": "Disable WeChat bottom citations for ordinary external links.",
                    "default": False,
                },
                "dry_run": {
                    "type": "boolean",
                    "description": "WeChat API dry run only.",
                    "default": False,
                },
                "remote_host": {"type": "string", "description": "WeChat remote-api SSH host."},
                "remote_user": {"type": "string", "description": "WeChat remote-api SSH user."},
                "remote_port": {"type": "integer", "description": "WeChat remote-api SSH port."},
                "remote_identity_file": {"type": "string", "description": "WeChat remote-api SSH identity file."},
                "remote_known_hosts_file": {"type": "string", "description": "WeChat remote-api known_hosts file."},
                "remote_strict_host_key_checking": {
                    "type": "string",
                    "enum": ["yes", "no", "accept-new"],
                    "description": "WeChat remote-api StrictHostKeyChecking option.",
                },
                "remote_connect_timeout": {"type": "integer", "description": "WeChat remote-api SSH ConnectTimeout seconds."},
                "remote_proxy_jump": {"type": "string", "description": "WeChat remote-api SSH ProxyJump spec."},
                "timeout_seconds": {
                    "type": "integer",
                    "description": "Subprocess timeout. Defaults to 1200 seconds.",
                    "default": DEFAULT_TIMEOUT_SECONDS,
                },
            },
            "required": ["platform"],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        command, expected_status, status_label = self._build_command(args, ctx)
        platform = str(args.get("platform") or "").strip().lower()
        timeout = int(args.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS)
        skill_name = _skill_name(platform)

        ctx.publish_metadata(
            title=f"baoyu publish: {platform}",
            metadata={"platform": platform, "expected_status": expected_status, "submit": bool(args.get("submit", False))},
        )

        result = await run_baoyu_command(
            command,
            cwd=baoyu_command_cwd(ctx, skill_name),
            timeout=timeout,
            env=baoyu_subprocess_env(),
        )
        payload = parse_json_from_stdout(result.stdout)
        actual_status = _status_from_result(platform, expected_status, result, payload)
        metadata = {
            "platform": platform,
            "kind": args.get("kind") or "",
            "method": args.get("method") or "auto",
            "status": actual_status,
            "status_label": _status_label(actual_status),
            "exit_code": result.exit_code,
            "command": result.args,
            "cwd": result.cwd,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "baoyu_json": payload,
            "publicly_visible": actual_status == "published",
        }
        if payload:
            metadata.update({key: value for key, value in payload.items() if key in {"media_id", "title", "articleType", "method"}})

        output = (
            f"Baoyu publish status: {_status_label(actual_status)}\n"
            f"Platform: {platform}\n"
            f"Expected action: {status_label}\n\n"
            + command_output(result)
        )
        if payload:
            output += "\n\nParsed result:\n" + json.dumps(payload, ensure_ascii=False, indent=2)
        output += "\n\nState explanation:\n" + _explanation_for_status(platform, actual_status)

        if result.exit_code != 0:
            return ToolResult(
                error=output,
                title=f"baoyu publish failed: {platform}",
                metadata={**metadata, "blocking_error": True},
            )

        return ToolResult(
            output=output,
            title=f"baoyu publish: {_status_label(actual_status)}",
            metadata=metadata,
        )

    def _build_command(self, args: dict[str, Any], ctx: ToolContext) -> tuple[list[str], str, str]:
        platform = str(args.get("platform") or "").strip().lower()
        if platform == "wechat":
            return self._wechat_command(args, ctx)
        if platform == "weibo":
            return self._weibo_command(args, ctx)
        if platform == "x":
            return self._x_command(args, ctx)
        raise ValueError(f"Unsupported platform: {platform}")

    def _wechat_command(self, args: dict[str, Any], ctx: ToolContext) -> tuple[list[str], str, str]:
        skill_dir = baoyu_skill_dir("baoyu-post-to-wechat")
        kind = str(args.get("kind") or "article")
        method = str(args.get("method") or "auto")
        if method == "auto":
            method = _resolve_wechat_method(args, ctx)
        submit = bool(args.get("submit", False))

        if kind == "image_text":
            command = [*resolve_bun_command(), str(skill_dir / "scripts" / "wechat-browser.ts")]
            markdown = resolve_optional_input_path(args.get("markdown_path"), ctx)
            if markdown:
                command.extend(["--markdown", markdown])
            else:
                title = _required_text(args, "title", "title is required for WeChat image_text without markdown_path.")
                command.extend(["--title", title])
                if text := _string_arg(args, "text"):
                    command.extend(["--content", text])
            for image in resolve_repeated_input_paths(args.get("images"), ctx):
                command.extend(["--image", image])
            if images_dir := resolve_optional_input_path(args.get("images_dir"), ctx):
                command.extend(["--images", images_dir])
            _append_profile_arg(command, args, ctx)
            _append_if_string(command, "--account", args.get("account"))
            if submit:
                command.append("--submit")
                return command, "draft_created", "save WeChat image-text draft"
            return command, "composed_pending_user", "compose WeChat image-text in browser"

        if method in {"api", "remote-api"}:
            source = _wechat_article_source_arg(args, ctx)
            command = [*resolve_bun_command(), str(skill_dir / "scripts" / "wechat-api.ts"), source]
            command.extend(["--theme", str(args.get("theme") or "default")])
            _append_if_string(command, "--color", args.get("color"))
            _append_if_string(command, "--title", args.get("title"))
            _append_if_string(command, "--summary", args.get("summary"))
            _append_if_string(command, "--author", args.get("author"))
            if cover := resolve_optional_input_path(args.get("cover"), ctx):
                command.extend(["--cover", cover])
            _append_if_string(command, "--account", args.get("account"))
            if bool(args.get("no_cite", False)):
                command.append("--no-cite")
            if bool(args.get("dry_run", False)) or not submit:
                command.append("--dry-run")
                expected = "dry_run"
                label = "render WeChat API payload without creating a draft"
            else:
                expected = "draft_created"
                label = "create WeChat Official Account draft via API"
            if method == "remote-api":
                command.append("--remote")
                _append_remote_args(command, args, ctx)
            return command, expected, label

        command = [*resolve_bun_command(), str(skill_dir / "scripts" / "wechat-article.ts")]
        markdown = resolve_optional_input_path(args.get("markdown_path"), ctx)
        html = resolve_optional_input_path(args.get("html_path"), ctx)
        if markdown:
            command.extend(["--markdown", markdown, "--theme", str(args.get("theme") or "default")])
            _append_if_string(command, "--color", args.get("color"))
        elif html:
            command.extend(["--html", html])
        else:
            command.extend(["--title", _required_text(args, "title", "title is required without markdown_path/html_path.")])
            command.extend(["--content", _required_text(args, "text", "text is required without markdown_path/html_path.")])
        _append_if_string(command, "--author", args.get("author"))
        _append_if_string(command, "--summary", args.get("summary"))
        for image in resolve_repeated_input_paths(args.get("images"), ctx):
            command.extend(["--image", image])
        if bool(args.get("no_cite", False)):
            command.append("--no-cite")
        _append_profile_arg(command, args, ctx)
        _append_if_string(command, "--account", args.get("account"))
        if submit:
            command.append("--submit")
            return command, "draft_created", "save WeChat article draft in browser"
        return command, "composed_pending_user", "compose WeChat article in browser"

    def _weibo_command(self, args: dict[str, Any], ctx: ToolContext) -> tuple[list[str], str, str]:
        skill_dir = baoyu_skill_dir("baoyu-post-to-weibo")
        kind = str(args.get("kind") or ("article" if args.get("markdown_path") else "post"))
        if kind == "article":
            markdown = resolve_optional_input_path(args.get("markdown_path"), ctx)
            if not markdown:
                raise ValueError("markdown_path is required for Weibo article publishing.")
            command = [*resolve_bun_command(), str(skill_dir / "scripts" / "weibo-article.ts"), markdown]
            _append_if_string(command, "--title", args.get("title"))
            _append_if_string(command, "--summary", args.get("summary"))
            if cover := resolve_optional_input_path(args.get("cover"), ctx):
                command.extend(["--cover", cover])
            _append_profile_arg(command, args, ctx)
            return command, "composed_pending_user", "compose Weibo headline article in browser"

        command = [*resolve_bun_command(), str(skill_dir / "scripts" / "weibo-post.ts")]
        text = _required_text(args, "text", "text is required for Weibo regular post.")
        command.append(text)
        for image in resolve_repeated_input_paths(args.get("images"), ctx):
            command.extend(["--image", image])
        if video := resolve_optional_input_path(args.get("video"), ctx):
            command.extend(["--video", video])
        _append_profile_arg(command, args, ctx)
        return command, "composed_pending_user", "compose Weibo post in browser"

    def _x_command(self, args: dict[str, Any], ctx: ToolContext) -> tuple[list[str], str, str]:
        skill_dir = baoyu_skill_dir("baoyu-post-to-x")
        kind = str(args.get("kind") or ("article" if args.get("markdown_path") else "post"))
        submit = bool(args.get("submit", False))
        if kind == "article":
            markdown = resolve_optional_input_path(args.get("markdown_path"), ctx)
            if not markdown:
                raise ValueError("markdown_path is required for X article publishing.")
            command = [*resolve_bun_command(), str(skill_dir / "scripts" / "x-article.ts"), markdown]
            _append_if_string(command, "--title", args.get("title"))
            if cover := resolve_optional_input_path(args.get("cover"), ctx):
                command.extend(["--cover", cover])
            _append_profile_arg(command, args, ctx)
            if submit:
                command.append("--submit")
                return command, "published", "publish X Article"
            return command, "composed_pending_user", "compose X Article draft in browser"

        if kind == "video":
            video = resolve_optional_input_path(args.get("video"), ctx)
            if not video:
                raise ValueError("video is required for X video posts.")
            command = [*resolve_bun_command(), str(skill_dir / "scripts" / "x-video.ts"), "--video", video]
            if text := _string_arg(args, "text"):
                command.append(text)
            _append_profile_arg(command, args, ctx)
        elif kind == "quote":
            tweet_url = _required_text(args, "tweet_url", "tweet_url is required for X quote posts.")
            command = [*resolve_bun_command(), str(skill_dir / "scripts" / "x-quote.ts"), tweet_url]
            if text := _string_arg(args, "text"):
                command.append(text)
            _append_profile_arg(command, args, ctx)
        else:
            command = [*resolve_bun_command(), str(skill_dir / "scripts" / "x-browser.ts")]
            if text := _string_arg(args, "text"):
                command.append(text)
            for image in resolve_repeated_input_paths(args.get("images"), ctx):
                command.extend(["--image", image])
            _append_profile_arg(command, args, ctx)

        if submit:
            command.append("--submit")
            return command, "published", "publish X post"
        return command, "composed_pending_user", "compose X post in browser"


def _skill_name(platform: str) -> str:
    return {
        "wechat": "baoyu-post-to-wechat",
        "weibo": "baoyu-post-to-weibo",
        "x": "baoyu-post-to-x",
    }[platform]


def _wechat_article_source_arg(args: dict[str, Any], ctx: ToolContext) -> str:
    markdown = resolve_optional_input_path(args.get("markdown_path"), ctx)
    if markdown:
        return markdown
    html = resolve_optional_input_path(args.get("html_path"), ctx)
    if html:
        return html
    if _string_arg(args, "text") or _string_arg(args, "title"):
        return _write_plain_markdown(args, ctx)
    raise ValueError("markdown_path or html_path is required for WeChat API publishing.")


def _resolve_wechat_method(args: dict[str, Any], ctx: ToolContext) -> str:
    if bool(args.get("dry_run", False)):
        return "api"
    config_path = baoyu_command_cwd(ctx, "baoyu-post-to-wechat") / ".baoyu-skills" / "baoyu-post-to-wechat" / "EXTEND.md"
    try:
        content = config_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return "browser"
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or not line.lower().startswith("default_publish_method:"):
            continue
        method = line.split(":", 1)[1].strip().strip("'\"").lower()
        if method in {"api", "remote-api", "browser"}:
            return method
    return "browser"


def _write_plain_markdown(args: dict[str, Any], ctx: ToolContext) -> str:
    title = _string_arg(args, "title") or "Untitled"
    text = _string_arg(args, "text") or ""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = output_base_dir(ctx) / "content-output" / f"wechat-plain-{stamp}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    content = f"# {title}\n\n{text.strip()}\n"
    path.write_text(content, encoding="utf-8")
    return str(path.resolve())


def _append_profile_arg(command: list[str], args: dict[str, Any], ctx: ToolContext) -> None:
    profile = _path_like_arg(args.get("profile"), ctx)
    if profile:
        command.extend(["--profile", profile])


def _append_remote_args(command: list[str], args: dict[str, Any], ctx: ToolContext) -> None:
    _append_if_string(command, "--remote-host", args.get("remote_host"))
    _append_if_string(command, "--remote-user", args.get("remote_user"))
    if args.get("remote_port"):
        command.extend(["--remote-port", str(args["remote_port"])])
    if identity := _path_like_arg(args.get("remote_identity_file"), ctx):
        command.extend(["--remote-identity-file", identity])
    if known_hosts := _path_like_arg(args.get("remote_known_hosts_file"), ctx):
        command.extend(["--remote-known-hosts-file", known_hosts])
    _append_if_string(command, "--remote-strict-host-key-checking", args.get("remote_strict_host_key_checking"))
    if args.get("remote_connect_timeout"):
        command.extend(["--remote-connect-timeout", str(args["remote_connect_timeout"])])
    _append_if_string(command, "--remote-proxy-jump", args.get("remote_proxy_jump"))


def _append_if_string(command: list[str], flag: str, value: Any) -> None:
    if isinstance(value, str) and value.strip():
        command.extend([flag, value.strip()])


def _path_like_arg(value: Any, ctx: ToolContext) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    path = Path(value.strip()).expanduser()
    if path.is_absolute():
        return str(path)
    return str((Path(ctx.workspace or ".").resolve() / path).resolve())


def _string_arg(args: dict[str, Any], name: str) -> str | None:
    value = args.get(name)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _required_text(args: dict[str, Any], name: str, error: str) -> str:
    value = _string_arg(args, name)
    if not value:
        raise ValueError(error)
    return value


def _status_from_result(
    platform: str,
    expected_status: str,
    result: Any,
    payload: dict[str, Any] | None,
) -> str:
    if result.exit_code != 0:
        return "failed"
    if expected_status == "dry_run":
        return "dry_run"
    if platform == "wechat" and payload and payload.get("success") and payload.get("media_id"):
        return "draft_created"
    return expected_status


def _status_label(status: str) -> str:
    return {
        "published": "已公开发布",
        "draft_created": "已创建平台草稿",
        "composed_pending_user": "已填入浏览器，待用户确认",
        "dry_run": "仅完成发布预演",
        "failed": "执行失败",
    }.get(status, status)


def _explanation_for_status(platform: str, status: str) -> str:
    if status == "published":
        return "脚本已执行最终提交动作，内容可能已经对外可见。"
    if status == "draft_created":
        if platform == "wechat":
            return "源 baoyu 的公众号能力到 WeChat 草稿箱为止，未调用公开发布接口。请到 mp.weixin.qq.com 草稿箱复核后群发/发布。"
        return "平台草稿已创建。"
    if status == "composed_pending_user":
        return "源 baoyu 脚本已把内容填入真实浏览器页面，但不会替用户点击最终公开发布按钮；请在浏览器中复核并手动确认。"
    if status == "dry_run":
        return "只做了渲染和参数检查，没有向平台提交内容。"
    return "脚本执行失败，按 STDERR/STDOUT 中的具体错误处理。"
