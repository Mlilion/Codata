"""Workflow helpers for expert team DAG execution."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.expert.models import ExpertDependsOnMode, ExpertTaskConfig, ExpertTeamConfig, ExpertTeamProcess

_TEMPLATE_RE = re.compile(r"\{\{([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*)\}\}")
_CONDITION_RE = re.compile(r"^(.+?)\s+(contains|equals|not_contains|not_equals)\s+(.+)$", re.IGNORECASE | re.DOTALL)


@dataclass
class ExpertWorkflowNode:
    """Runtime DAG node for one expert task."""

    task: ExpertTaskConfig
    dependencies: list[str]
    dependents: list[str] = field(default_factory=list)
    status: str = "pending"
    result: str = ""
    error: str = ""
    level: int = 0
    sequence: int = 0
    iterations: int = 0


@dataclass
class ExpertWorkflowDAG:
    """Task graph grouped into executable topological levels."""

    nodes: dict[str, ExpertWorkflowNode]
    levels: list[list[str]]


def build_dag(team: ExpertTeamConfig) -> ExpertWorkflowDAG:
    """Build and validate a topological task graph."""
    nodes: dict[str, ExpertWorkflowNode] = {}
    for task in team.tasks:
        dependencies = list(task.depends_on or task.context)
        nodes[task.id] = ExpertWorkflowNode(task=task, dependencies=dependencies)

    for node_id, node in nodes.items():
        for dep in node.dependencies:
            if dep not in nodes:
                raise RuntimeError(f"Task '{node_id}' depends on unknown task '{dep}'")
            nodes[dep].dependents.append(node_id)

    levels = _topological_levels(nodes)
    for level_index, level in enumerate(levels):
        for node_id in level:
            nodes[node_id].level = level_index

    for node in nodes.values():
        if node.task.loop:
            back_to = node.task.loop.back_to
            if back_to not in nodes:
                raise RuntimeError(f"Task '{node.task.id}' loop back_to references unknown task '{back_to}'")
            if nodes[back_to].level >= node.level:
                raise RuntimeError(f"Task '{node.task.id}' loop back_to must point to an upstream task")

    return ExpertWorkflowDAG(nodes=nodes, levels=levels)


def execution_team_for_process(team: ExpertTeamConfig) -> ExpertTeamConfig:
    """Return the DAG execution view for a team process.

    Sequential teams preserve list order by adding an implicit dependency from
    each task to the previous task when no explicit dependency is declared. If a
    task declares depends_on/context, the explicit graph is respected.
    """
    if team.process != ExpertTeamProcess.SEQUENTIAL:
        return team

    tasks: list[ExpertTaskConfig] = []
    previous_id: str | None = None
    for task in team.tasks:
        data = task.model_dump(mode="python")
        if previous_id:
            if not (data.get("depends_on") or data.get("context")):
                data["depends_on"] = [previous_id]
                data["context"] = [previous_id]
        tasks.append(ExpertTaskConfig(**data))
        previous_id = task.id

    return team.model_copy(
        update={
            "tasks": tasks,
            "concurrency": 1,
        }
    )


def render_template(template: str, context: dict[str, str], *, strict: bool = True) -> str:
    """Render {{variable}} placeholders using workflow context."""

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        resolved = _resolve_template_value(key, context)
        if resolved is None:
            if not strict:
                return "[上游任务未产出]"
            raise RuntimeError(f"Template variable not found: {{{{{key}}}}}")
        return resolved

    return _TEMPLATE_RE.sub(replace, template)


def _resolve_template_value(key: str, context: dict[str, str]) -> str | None:
    if key in context:
        return context[key]
    root, path = _split_template_path(key)
    if not root or root not in context or not path:
        return None
    try:
        import json

        value = json.loads(context[root])
    except Exception:
        return None
    current = value
    for part in path:
        if isinstance(part, int):
            if not isinstance(current, list) or part < 0 or part >= len(current):
                return None
            current = current[part]
            continue
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    if isinstance(current, str):
        return current
    try:
        import json

        return json.dumps(current, ensure_ascii=False, separators=(",", ":"))
    except TypeError:
        return str(current)


def _split_template_path(key: str) -> tuple[str, list[str | int]]:
    parts: list[str | int] = []
    root_match = re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*", key)
    if not root_match:
        return "", []
    root = root_match.group(0)
    index = len(root)
    while index < len(key):
        if key[index] == ".":
            index += 1
            match = re.match(r"[a-zA-Z_][a-zA-Z0-9_]*", key[index:])
            if not match:
                return root, []
            parts.append(match.group(0))
            index += len(match.group(0))
            continue
        if key[index] == "[":
            end = key.find("]", index)
            if end < 0:
                return root, []
            raw_index = key[index + 1:end]
            if not raw_index.isdigit():
                return root, []
            parts.append(int(raw_index))
            index = end + 1
            continue
        return root, []
    return root, parts


def evaluate_condition(condition: str, context: dict[str, str]) -> bool:
    """Evaluate a simple rendered condition expression."""
    rendered = render_template(condition, context)
    match = _CONDITION_RE.match(rendered.strip())
    if not match:
        raise RuntimeError("Condition must use contains, equals, not_contains, or not_equals")

    left = _normalize(match.group(1))
    op = match.group(2).lower()
    right = _normalize(match.group(3).strip().strip("\"'"))
    if op == "contains":
        return right in left
    if op == "not_contains":
        return right not in left
    if op == "equals":
        return left == right
    if op == "not_equals":
        return left != right
    raise RuntimeError(f"Unsupported condition operator: {op}")


def dependencies_ready(node: ExpertWorkflowNode, nodes: dict[str, ExpertWorkflowNode]) -> bool:
    """Return whether a pending node is eligible to run."""
    if not node.dependencies:
        return True
    upstream = [nodes[dep] for dep in node.dependencies]
    completed_statuses = {"completed", "truncated"}
    if node.task.depends_on_mode == ExpertDependsOnMode.ANY_COMPLETED:
        if any(item.status in completed_statuses for item in upstream):
            return True
        return all(item.status in {"skipped", "failed"} for item in upstream)
    return all(item.status in completed_statuses for item in upstream)


def should_skip_for_dependencies(node: ExpertWorkflowNode, nodes: dict[str, ExpertWorkflowNode]) -> bool:
    """Return whether a node can no longer run because upstream work did not complete."""
    if not node.dependencies:
        return False
    upstream = [nodes[dep] for dep in node.dependencies]
    if node.task.depends_on_mode == ExpertDependsOnMode.ANY_COMPLETED:
        return all(item.status in {"skipped", "failed"} for item in upstream)
    return any(item.status in {"skipped", "failed"} for item in upstream)


def reset_range(dag: ExpertWorkflowDAG, start_task_id: str, end_task_id: str) -> tuple[int, list[ExpertWorkflowNode]]:
    """Reset nodes from start level through end level and return the next level index."""
    start_level = dag.nodes[start_task_id].level
    end_level = dag.nodes[end_task_id].level
    reset_nodes: list[ExpertWorkflowNode] = []
    for level_index in range(start_level, end_level + 1):
        for node_id in dag.levels[level_index]:
            node = dag.nodes[node_id]
            node.status = "pending"
            node.result = ""
            node.error = ""
            reset_nodes.append(node)
    return start_level, reset_nodes


def _topological_levels(nodes: dict[str, ExpertWorkflowNode]) -> list[list[str]]:
    in_degree = {node_id: len(node.dependencies) for node_id, node in nodes.items()}
    remaining = set(nodes)
    levels: list[list[str]] = []

    while remaining:
        level = [node_id for node_id in nodes if node_id in remaining and in_degree[node_id] == 0]
        if not level:
            raise RuntimeError("Expert workflow contains a circular dependency")
        for node_id in level:
            remaining.remove(node_id)
            for dependent in nodes[node_id].dependents:
                in_degree[dependent] -= 1
        levels.append(level)

    return levels


def _normalize(value: str) -> str:
    return " ".join(value.strip().lower().split())
