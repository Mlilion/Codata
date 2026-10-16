"""Middleware: inject todo reminders after modifying tools.

When the agent has active todos and executes a state-modifying tool
(edit, write, bash, code_execute), append a reminder to the tool output
so the LLM remembers to update todo status.
"""

from __future__ import annotations

from typing import Any

from app.session.middleware import Middleware, MiddlewareContext

_MODIFYING_TOOLS = frozenset({"edit", "write", "bash", "code_execute"})


class TodoReminderMiddleware(Middleware):
    """Appends todo reminders to modifying tool outputs."""

    def __init__(self, get_todos_fn: Any = None) -> None:
        """
        Args:
            get_todos_fn: Callable that returns the current todo list.
                          Signature: () -> list[dict]
        """
        self._get_todos = get_todos_fn

    async def after_tool_exec(
        self,
        tool_name: str,
        tool_args: dict[str, Any],
        output: str,
        ctx: MiddlewareContext,
    ) -> str:
        if tool_name not in _MODIFYING_TOOLS or tool_name == "todo":
            return output

        if self._get_todos is None:
            return output

        todos = self._get_todos()
        if not todos:
            return output

        incomplete = [t for t in todos if t.get("status") in ("pending", "in_progress")]
        if not incomplete:
            return output

        output += (
            "\n\n<reminder>You have an active todo list. "
            "Call the todo tool NOW to mark this task completed "
            "and start the next one.</reminder>"
        )
        return output
