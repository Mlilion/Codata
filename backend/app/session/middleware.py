"""Middleware protocol and chain for the agent processing loop.

Defines composable middleware that intercepts LLM calls, tool execution,
and message sanitization. This replaces inline cross-cutting concerns
in SessionProcessor with a pluggable chain.

Middleware hooks:
  - before_llm_call(messages, ctx) → messages
    Modify messages before sending to LLM. Return modified messages.
  - after_llm_response(text, tool_calls, ctx) → (text, tool_calls)
    Inspect/modify LLM response before tool execution.
  - before_tool_exec(tool_name, tool_args, ctx) → ToolAction
    Decide whether to allow, warn, or block a tool call.
  - after_tool_exec(tool_name, tool_args, result, ctx) → result_output
    Modify tool result output before it's persisted.
  - on_step_complete(ctx) → None
    Called after each step completes.

Each hook has a default no-op implementation. Middlewares only need to
override the hooks they care about.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    from app.streaming.manager import GenerationJob

logger = logging.getLogger(__name__)


@dataclass
class MiddlewareContext:
    """Shared context passed through all middleware hooks.

    Contains references to the current session state that middlewares
    may read or modify.
    """

    session_id: str
    step: int
    job: GenerationJob
    model_id: str | None = None
    agent_name: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolAction:
    """Result of before_tool_exec: what to do with the tool call."""

    action: str  # "allow" | "warn" | "block"
    message: str | None = None  # Warning/block message


class Middleware:
    """Base middleware class with no-op defaults for all hooks.

    Subclass and override only the hooks you need.
    """

    async def before_llm_call(
        self,
        messages: list[dict[str, Any]],
        ctx: MiddlewareContext,
    ) -> list[dict[str, Any]]:
        """Called before LLM invocation. Return (possibly modified) messages."""
        return messages

    async def after_llm_response(
        self,
        text: str,
        tool_calls: list[dict[str, Any]],
        ctx: MiddlewareContext,
    ) -> tuple[str, list[dict[str, Any]]]:
        """Called after LLM responds. Return (possibly modified) text and tool_calls."""
        return text, tool_calls

    async def before_tool_exec(
        self,
        tool_name: str,
        tool_args: dict[str, Any],
        ctx: MiddlewareContext,
    ) -> ToolAction:
        """Called before each tool execution. Return action decision."""
        return ToolAction(action="allow")

    async def after_tool_exec(
        self,
        tool_name: str,
        tool_args: dict[str, Any],
        output: str,
        ctx: MiddlewareContext,
    ) -> str:
        """Called after tool execution. Return (possibly modified) output."""
        return output

    async def on_step_complete(self, ctx: MiddlewareContext) -> None:
        """Called when a processing step completes."""
        pass


class MiddlewareChain:
    """Executes a sequence of middlewares in order.

    Each hook iterates through all middlewares, passing the result
    of one middleware as input to the next.
    """

    def __init__(self, middlewares: list[Middleware] | None = None) -> None:
        self._middlewares = middlewares or []

    def add(self, middleware: Middleware) -> None:
        self._middlewares.append(middleware)

    async def run_before_llm_call(
        self,
        messages: list[dict[str, Any]],
        ctx: MiddlewareContext,
    ) -> list[dict[str, Any]]:
        for mw in self._middlewares:
            messages = await mw.before_llm_call(messages, ctx)
        return messages

    async def run_after_llm_response(
        self,
        text: str,
        tool_calls: list[dict[str, Any]],
        ctx: MiddlewareContext,
    ) -> tuple[str, list[dict[str, Any]]]:
        for mw in self._middlewares:
            text, tool_calls = await mw.after_llm_response(text, tool_calls, ctx)
        return text, tool_calls

    async def run_before_tool_exec(
        self,
        tool_name: str,
        tool_args: dict[str, Any],
        ctx: MiddlewareContext,
    ) -> ToolAction:
        """Run before_tool_exec on all middlewares. First non-allow result wins."""
        for mw in self._middlewares:
            result = await mw.before_tool_exec(tool_name, tool_args, ctx)
            if result.action != "allow":
                return result
        return ToolAction(action="allow")

    async def run_after_tool_exec(
        self,
        tool_name: str,
        tool_args: dict[str, Any],
        output: str,
        ctx: MiddlewareContext,
    ) -> str:
        for mw in self._middlewares:
            output = await mw.after_tool_exec(tool_name, tool_args, output, ctx)
        return output

    async def run_on_step_complete(self, ctx: MiddlewareContext) -> None:
        for mw in self._middlewares:
            await mw.on_step_complete(ctx)

    @property
    def middlewares(self) -> list[Middleware]:
        return list(self._middlewares)
