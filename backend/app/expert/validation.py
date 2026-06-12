"""Validation helpers for expert team workflow definitions."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from app.expert.models import ExpertDependsOnMode, ExpertManagerSubmode, ExpertTeamConfig, ExpertTeamProcess
from app.expert.workflow import build_dag, execution_team_for_process

_TEMPLATE_VAR_RE = re.compile(r"\{\{([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*)\}\}")


def validate_expert_team_config(team: ExpertTeamConfig) -> list[str]:
    """Return human-readable validation errors for an expert team config."""
    errors: list[str] = []
    execution_team = execution_team_for_process(team)
    member_ids = [member.id for member in team.members]
    task_ids = [task.id for task in execution_team.tasks]
    input_names = {item.name for item in execution_team.inputs}

    errors.extend(_duplicates("member id", member_ids))
    errors.extend(_duplicates("task id", task_ids))

    member_id_set = set(member_ids)
    task_id_set = set(task_ids)
    task_by_id: dict[str, Any] = {task.id: task for task in execution_team.tasks}

    if team.manager and team.manager.member and team.manager.member not in member_id_set:
        errors.append(f"Manager references unknown member '{team.manager.member}'")
    if team.finalization.member and team.finalization.member not in member_id_set:
        errors.append(f"Finalization references unknown member '{team.finalization.member}'")
    deliverable = team.finalization.deliverable
    if deliverable and deliverable.source not in {"last_task", "coordinator"}:
        known_outputs = {task.output for task in execution_team.tasks if task.output}
        if deliverable.source not in task_id_set and deliverable.source not in known_outputs:
            errors.append(f"Finalization deliverable source '{deliverable.source}' does not match a task id or output")

    for task in execution_team.tasks:
        if task.member not in member_id_set:
            errors.append(f"Task '{task.id}' references unknown member '{task.member}'")
        for dep in task.depends_on or task.context:
            if dep not in task_id_set:
                errors.append(f"Task '{task.id}' depends on unknown task '{dep}'")
            if dep == task.id:
                errors.append(f"Task '{task.id}' cannot depend on itself")
        if task.loop and task.loop.back_to not in task_id_set:
            errors.append(f"Task '{task.id}' loop references unknown task '{task.loop.back_to}'")

    errors.extend(_validate_output_ownership(execution_team))
    errors.extend(_validate_template_refs(execution_team, input_names, task_by_id))

    try:
        build_dag(execution_team)
    except Exception as exc:
        errors.append(str(exc))

    if (
        team.process == ExpertTeamProcess.HIERARCHICAL
        and team.manager
        and team.manager.submode == ExpertManagerSubmode.AUTONOMOUS
        and not execution_team.tasks
    ):
        return _unique(errors)

    return _unique(errors)


def _duplicates(label: str, values: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: list[str] = []
    for value in values:
        if value in seen:
            duplicates.append(f"Duplicate {label}: {value}")
        seen.add(value)
    return duplicates


def _validate_output_ownership(team: ExpertTeamConfig) -> list[str]:
    output_to_tasks: dict[str, list[str]] = defaultdict(list)
    task_by_id: dict[str, Any] = {task.id: task for task in team.tasks}
    errors: list[str] = []

    for task in team.tasks:
        if task.output:
            output_to_tasks[task.output].append(task.id)

    for output, owners in output_to_tasks.items():
        if len(owners) <= 1:
            continue
        owner_set = set(owners)
        has_any_completed_consumer = any(
            task.depends_on_mode == ExpertDependsOnMode.ANY_COMPLETED
            and any(dep in owner_set for dep in task.depends_on or task.context)
            for task in team.tasks
        )
        if has_any_completed_consumer:
            continue
        has_loop_owner = any(task_by_id[task_id].loop for task_id in owners)
        if has_loop_owner:
            continue
        errors.append(
            f"Output variable '{output}' is produced by multiple tasks: {', '.join(owners)}"
        )

    return errors


def _validate_template_refs(
    team: ExpertTeamConfig,
    input_names: set[str],
    task_by_id: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    produced_by = {
        task.output: task.id
        for task in team.tasks
        if task.output
    }

    for task in team.tasks:
        upstream_ids = _upstream_task_ids(task.id, task_by_id)
        upstream_outputs = {
            task_by_id[task_id].output
            for task_id in upstream_ids
            if getattr(task_by_id[task_id], "output", None)
        }
        allowed = {"user_input", "input", "workspace", "attachments", "clarifications", "_loop_iteration"}
        allowed.update(input_names)
        allowed.update(upstream_outputs)

        texts = [task.task or "", task.description or "", task.condition or ""]
        if task.loop:
            texts.append(task.loop.exit_condition)
        seen_refs: set[str] = set()
        for text in texts:
            for variable in _TEMPLATE_VAR_RE.findall(text):
                if variable in seen_refs:
                    continue
                seen_refs.add(variable)
                root_variable = variable.split(".", 1)[0].split("[", 1)[0]
                if variable in allowed or root_variable in allowed:
                    continue
                owner = produced_by.get(root_variable)
                if owner:
                    errors.append(
                        f"Task '{task.id}' references {{{{{variable}}}}}, but producer task '{owner}' is not upstream"
                    )
                else:
                    errors.append(f"Task '{task.id}' references unknown template variable {{{{{variable}}}}}")

    return errors


def _upstream_task_ids(task_id: str, task_by_id: dict[str, Any]) -> set[str]:
    upstream: set[str] = set()
    stack = [task_id]
    while stack:
        current_id = stack.pop()
        task = task_by_id.get(current_id)
        if task is None:
            continue
        for dep in getattr(task, "depends_on", None) or getattr(task, "context", None) or []:
            if dep in upstream:
                continue
            upstream.add(dep)
            stack.append(dep)
    return upstream


def _unique(errors: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for error in errors:
        if error in seen:
            continue
        seen.add(error)
        result.append(error)
    return result
