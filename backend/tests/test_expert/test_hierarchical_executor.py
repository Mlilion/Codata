from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.expert.executors.hierarchical import HierarchicalExecutor
from app.expert.models import ExpertTeamConfig, ExpertTeamSummonRequest
from app.expert.runner import ExpertTeamRunner
from app.streaming.manager import GenerationJob


def _runner(team: ExpertTeamConfig) -> ExpertTeamRunner:
    return ExpertTeamRunner(
        team=team,
        request=ExpertTeamSummonRequest(input="用户任务"),
        job=GenerationJob(stream_id="stream", session_id="session"),
        session_factory=None,  # type: ignore[arg-type]
        provider_registry=None,  # type: ignore[arg-type]
        tool_registry=None,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_hierarchical_manager_delegates_and_aggregates() -> None:
    team = ExpertTeamConfig(
        id="hier",
        name="层级团队",
        process="hierarchical",
        finalization={"mode": "last_task"},
        manager={"submode": "autonomous"},
        members=[
            {"id": "manager", "name": "经理", "role": "经理", "goal": "管理"},
            {"id": "writer", "name": "写作专家", "role": "写作", "goal": "写作"},
        ],
        tasks=[],
    )
    runner = _runner(team)
    executor = HierarchicalExecutor(runner)

    calls = []

    async def fake_run_task(step, task, member, **kwargs):
        calls.append((step, task.id, member.id, kwargs.get("snapshot_extra", {})))
        if task.id == "__manager__":
            return SimpleNamespace(text="manager output", usage={"input": 1, "output": 1, "reasoning": 0, "cache_read": 0, "cache_write": 0}, cost=0.0, status="completed", rounds=1, truncated=False, structured=None)
        return SimpleNamespace(text="child output", usage={"input": 1, "output": 1, "reasoning": 0, "cache_read": 0, "cache_write": 0}, cost=0.0, status="completed", rounds=1, truncated=False, structured=None)

    async def fake_execute_synthetic_tool(name, args, call_id, message_id, messages):
        if name == "delegate_work":
            await fake_run_task(2, SimpleNamespace(id="child"), SimpleNamespace(id="writer"), snapshot_extra={"delegated": True})
            return "delegated"
        return None

    runner.task_runner.run_task = fake_run_task  # type: ignore[method-assign]
    executor._execute_synthetic_tool = fake_execute_synthetic_tool  # type: ignore[method-assign]
    executor._manager_system_prompt = lambda *args, **kwargs: "system"  # type: ignore[method-assign]
    executor._manager_user_message = lambda *args, **kwargs: "user"  # type: ignore[method-assign]
    executor._tool_specs = lambda: []  # type: ignore[method-assign]

    await executor.execute()

    assert any(call[1] == "__manager__" for call in calls)
    assert runner.task_outputs["__manager__"] == "manager output"
    assert runner.task_statuses["__manager__"]["manager"] is True


def test_hierarchical_reserved_manager_id_rejected() -> None:
    with pytest.raises(ValueError, match="reserved"):
        ExpertTeamConfig(
            id="reserved",
            name="层级团队",
            process="hierarchical",
            manager={"submode": "autonomous"},
            members=[{"id": "__manager__", "name": "经理", "role": "经理", "goal": "管理"}],
            tasks=[],
        )


@pytest.mark.asyncio
async def test_hierarchical_invalid_coworker_returns_tool_error() -> None:
    team = ExpertTeamConfig(
        id="hier-invalid",
        name="层级团队",
        process="hierarchical",
        manager={"submode": "autonomous"},
        members=[{"id": "writer", "name": "写作专家", "role": "写作", "goal": "写作"}],
        tasks=[],
    )
    runner = _runner(team)
    executor = HierarchicalExecutor(runner)

    message = await executor._execute_synthetic_tool(
        "delegate_work",
        {"coworker": "missing", "task": "写作"},
        "call-1",
        "message-1",
        [],
    )

    assert message and "Coworker not found" in message


@pytest.mark.asyncio
async def test_hierarchical_delegate_returns_handoff_not_full_output() -> None:
    team = ExpertTeamConfig(
        id="hier-handoff",
        name="层级交接团队",
        process="hierarchical",
        manager={"member": "manager", "submode": "autonomous"},
        members=[
            {"id": "manager", "name": "经理", "role": "经理", "goal": "管理"},
            {"id": "writer", "name": "写作专家", "role": "写作", "goal": "写作"},
        ],
        tasks=[],
    )
    runner = _runner(team)
    executor = HierarchicalExecutor(runner)
    full_output = "完整正文\n" + ("很长的细节" * 1000) + "\n关键结论：只把这个交给经理"

    async def fake_run_task(_step, task, _member, **_kwargs):
        runner._record_task_output(task, full_output, status="completed")
        return SimpleNamespace(
            text=full_output,
            usage={"input": 1, "output": 1, "reasoning": 0, "cache_read": 0, "cache_write": 0},
            cost=0.0,
            status="completed",
            rounds=1,
            truncated=False,
            structured=None,
        )

    runner.task_runner.run_task = fake_run_task  # type: ignore[method-assign]

    output = await executor._execute_synthetic_tool(
        "delegate_work",
        {"coworker": "writer", "task": "写一份内容"},
        "call-1",
        "message-1",
        [],
    )

    assert output is not None
    assert "Handoff:" in output
    assert "关键结论：只把这个交给经理" in output
    assert len(output) < len(full_output)
