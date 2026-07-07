"""Shared execution contracts for expert team orchestration."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


TOKEN_KEYS = ("input", "output", "reasoning", "cache_read", "cache_write")


def empty_usage() -> dict[str, int]:
    """Return a canonical token bucket used by Codata streams."""
    return {key: 0 for key in TOKEN_KEYS}


@dataclass(slots=True)
class TaskResult:
    """Result of one expert task execution."""

    text: str
    structured: dict[str, Any] | None = None
    usage: dict[str, int] = field(default_factory=empty_usage)
    cost: float = 0.0
    status: str = "completed"
    rounds: int = 0
    truncated: bool = False


@dataclass(slots=True)
class RunState:
    """Shared expert-team run state exposed to executors."""

    context: dict[str, str]
    task_outputs: dict[str, str]
    task_summaries: dict[str, str]
    task_statuses: dict[str, dict[str, Any]]
    total_tokens: dict[str, int]
    total_cost: float = 0.0


class ProcessExecutor(Protocol):
    """Process strategy interface used by ExpertTeamRunner."""

    async def execute(self) -> None:
        """Run the configured process."""
