"""Workflow-based expert-team process executors."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.expert.workflow import execution_team_for_process

if TYPE_CHECKING:
    from app.expert.runner import ExpertTeamRunner


class WorkflowExecutor:
    """Execute a team using its explicit workflow DAG."""

    def __init__(self, runner: "ExpertTeamRunner") -> None:
        self._runner = runner

    async def execute(self) -> None:
        await self._runner._run_workflow(team=self._runner.team)


class SequentialExecutor:
    """Execute sequential teams through the same DAG engine as workflow teams."""

    def __init__(self, runner: "ExpertTeamRunner") -> None:
        self._runner = runner

    async def execute(self) -> None:
        team = execution_team_for_process(self._runner.team)
        await self._runner._run_workflow(team=team, concurrency=1)
