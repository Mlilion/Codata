from app.expert.models import ExpertTeamConfig
from app.expert.validation import validate_expert_team_config
from app.expert.workflow import execution_team_for_process


def _team(**overrides) -> ExpertTeamConfig:
    data = {
        "id": "test-team",
        "name": "测试专家团",
        "members": [
            {"id": "a", "name": "A", "role": "规划", "goal": "规划"},
            {"id": "b", "name": "B", "role": "执行", "goal": "执行"},
        ],
        "tasks": [
            {
                "id": "plan",
                "name": "规划",
                "member": "a",
                "task": "分析 {{user_input}}",
                "output": "plan_result",
            },
            {
                "id": "do",
                "name": "执行",
                "member": "b",
                "task": "执行 {{plan_result}}",
                "depends_on": ["plan"],
                "output": "final_result",
            },
        ],
    }
    data.update(overrides)
    return ExpertTeamConfig(**data)


def test_validation_accepts_upstream_output_reference() -> None:
    assert validate_expert_team_config(_team()) == []


def test_validation_rejects_downstream_output_reference() -> None:
    team = _team(
        tasks=[
            {
                "id": "plan",
                "name": "规划",
                "member": "a",
                "task": "提前引用 {{final_result}}",
                "output": "plan_result",
            },
            {
                "id": "do",
                "name": "执行",
                "member": "b",
                "task": "执行",
                "depends_on": ["plan"],
                "output": "final_result",
            },
        ]
    )

    errors = validate_expert_team_config(team)

    assert any("producer task 'do' is not upstream" in error for error in errors)


def test_validation_rejects_duplicate_output_variables() -> None:
    team = _team(
        tasks=[
            {"id": "one", "name": "一", "member": "a", "task": "一", "output": "same"},
            {"id": "two", "name": "二", "member": "b", "task": "二", "output": "same"},
        ]
    )

    errors = validate_expert_team_config(team)

    assert any("Output variable 'same'" in error for error in errors)


def test_sequential_execution_view_adds_implicit_dependencies() -> None:
    team = ExpertTeamConfig(
        id="sequential-team",
        name="顺序专家团",
        process="sequential",
        members=[
            {"id": "a", "name": "A", "role": "规划", "goal": "规划"},
            {"id": "b", "name": "B", "role": "执行", "goal": "执行"},
        ],
        tasks=[
            {"id": "plan", "name": "规划", "member": "a", "task": "分析 {{user_input}}", "output": "plan_result"},
            {"id": "do", "name": "执行", "member": "b", "task": "执行 {{plan_result}}", "output": "final_result"},
        ],
    )

    execution_team = execution_team_for_process(team)

    assert execution_team.tasks[1].depends_on == ["plan"]
    assert validate_expert_team_config(team) == []


def test_sequential_honors_explicit_dependencies_in_validation() -> None:
    team = ExpertTeamConfig(
        id="sequential-explicit",
        name="显式依赖顺序专家团",
        process="sequential",
        members=[
            {"id": "a", "name": "A", "role": "规划", "goal": "规划"},
            {"id": "b", "name": "B", "role": "执行", "goal": "执行"},
        ],
        tasks=[
            {
                "id": "consumer",
                "name": "消费者",
                "member": "b",
                "task": "提前引用 {{plan_result}}",
                "depends_on": ["producer"],
            },
            {"id": "producer", "name": "生产者", "member": "a", "task": "生产", "output": "plan_result"},
        ],
    )

    errors = validate_expert_team_config(team)

    assert any("circular dependency" in error.lower() or "producer task 'producer' is not upstream" in error for error in errors)


def test_hierarchical_autonomous_allows_empty_tasks() -> None:
    team = ExpertTeamConfig(
        id="hier-autonomous",
        name="层级自治",
        process="hierarchical",
        manager={"submode": "autonomous"},
        members=[{"id": "a", "name": "A", "role": "经理", "goal": "管理"}],
        tasks=[],
    )

    assert team.process == "hierarchical"
    assert team.tasks == []
