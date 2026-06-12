"""Middleware: fix dangling tool calls in message history.

A dangling tool call occurs when an assistant message contains tool_calls
but there is no corresponding tool-result message (e.g., user cancelled
mid-generation). This breaks LLMs that expect paired messages.

Injects synthetic error ToolMessages immediately after the dangling
assistant message, preserving correct message ordering.
"""

from __future__ import annotations

import logging
from typing import Any

from app.session.middleware import Middleware, MiddlewareContext

logger = logging.getLogger(__name__)


class DanglingToolCallMiddleware(Middleware):
    """Patches dangling tool calls before LLM sees the message history."""

    async def before_llm_call(
        self,
        messages: list[dict[str, Any]],
        ctx: MiddlewareContext,
    ) -> list[dict[str, Any]]:
        # Collect IDs of all existing tool-result messages
        existing_ids: set[str] = set()
        for msg in messages:
            if msg.get("role") == "tool":
                tid = msg.get("tool_call_id")
                if tid:
                    existing_ids.add(tid)

        # Quick check: anything to patch?
        needs_patch = False
        for msg in messages:
            if msg.get("role") != "assistant":
                continue
            for tc in msg.get("tool_calls") or []:
                if tc.get("id") and tc["id"] not in existing_ids:
                    needs_patch = True
                    break
            if needs_patch:
                break

        if not needs_patch:
            return messages

        # Build patched list
        patched: list[dict[str, Any]] = []
        patch_count = 0
        patched_ids: set[str] = set()
        for msg in messages:
            patched.append(msg)
            if msg.get("role") != "assistant":
                continue
            for tc in msg.get("tool_calls") or []:
                tc_id = tc.get("id")
                if tc_id and tc_id not in existing_ids and tc_id not in patched_ids:
                    patched.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": "[Tool call was interrupted and did not return a result.]",
                    })
                    patched_ids.add(tc_id)
                    patch_count += 1

        logger.warning(
            "Patched %d dangling tool call(s) with synthetic error responses",
            patch_count,
        )
        return patched
