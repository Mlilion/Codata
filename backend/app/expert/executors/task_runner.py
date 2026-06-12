"""Task execution facade for expert-team task runs.

The heavy lifting still lives on ``ExpertTeamRunner`` while M1 introduces the
stable TaskRunner/TaskResult boundary. Later phases can move the loop internals
behind this facade without changing process executors.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

from app.expert.executors.base import TaskResult
from app.expert.models import ExpertMemberConfig, ExpertTaskConfig

if TYPE_CHECKING:
    from app.expert.runner import ExpertTeamRunner


class TaskRunner:
    """Run one expert task through the WorkCraft LLM/tool loop."""

    def __init__(self, runner: "ExpertTeamRunner") -> None:
        self._runner = runner

    async def run_task(
        self,
        step: int,
        task: ExpertTaskConfig,
        member: ExpertMemberConfig,
        *,
        extra_tool_specs: list[dict[str, Any]] | None = None,
        synthetic_tool_executor: Callable[[str, dict[str, Any], str, str, list[dict[str, Any]]], Awaitable[str]] | None = None,
        snapshot_extra: dict[str, Any] | None = None,
        record_output: bool = True,
        system_override: str | None = None,
        messages_override: list[dict[str, Any]] | None = None,
        message_id_override: str | None = None,
    ) -> TaskResult:
        return await self._runner._run_task_impl(
            step,
            task,
            member,
            extra_tool_specs=extra_tool_specs,
            synthetic_tool_executor=synthetic_tool_executor,
            snapshot_extra=snapshot_extra,
            record_output=record_output,
            system_override=system_override,
            messages_override=messages_override,
            message_id_override=message_id_override,
        )
