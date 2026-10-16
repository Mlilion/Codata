"""Hierarchical manager-delegation executor for expert teams."""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any

from app.expert.models import (
    ExpertManagerConfig,
    ExpertManagerSubmode,
    ExpertMemberConfig,
    ExpertTaskConfig,
)
from app.session.manager import create_part, update_part_data
from app.utils.id import generate_ulid

if TYPE_CHECKING:
    from app.expert.runner import ExpertTeamRunner


_AUTO_MANAGER_ID = "__manager__"


class HierarchicalExecutor:
    """Run a manager agent that delegates work to coworker experts."""

    def __init__(self, runner: "ExpertTeamRunner") -> None:
        self._runner = runner
        self._delegation_count = 0
        self._delegated_results: list[dict[str, Any]] = []

    async def execute(self) -> None:
        manager_config = self._runner.team.manager or ExpertManagerConfig()
        manager = self._manager_member(manager_config)
        coworkers = self._coworkers(manager)
        if not coworkers:
            raise RuntimeError("Hierarchical expert team requires at least one coworker")
        self._delegation_count = max(self._delegation_count, self._restored_delegation_count())

        manager_task = ExpertTaskConfig(
            id=_AUTO_MANAGER_ID,
            name="经理调度与最终交付",
            member=manager.id,
            task="Use delegation tools to complete the user's request, then provide the final answer.",
            expected_output="A final answer synthesized from delegated expert work.",
            max_tool_rounds=self._runner.team.default_max_tool_rounds,
        )
        system = self._manager_system_prompt(manager_config, manager, coworkers)
        messages = [{"role": "user", "content": self._manager_user_message(manager_config, coworkers)}]
        result = await self._runner.task_runner.run_task(
            1,
            manager_task,
            manager,
            extra_tool_specs=self._tool_specs(),
            synthetic_tool_executor=self._execute_synthetic_tool,
            snapshot_extra={
                "hierarchical": True,
                "manager": True,
                "process": self._runner.team.process,
                "skills": self._runner._capability_lists(manager)[0],
                "tools": self._runner._capability_lists(manager)[1],
            },
            record_output=True,
            system_override=system,
            messages_override=messages,
        )
        manager_handoff = self._runner._task_handoff_text(_AUTO_MANAGER_ID, self._runner.team.coordinator_context_max_chars)
        self._runner.task_outputs["__manager__"] = result.text
        self._runner.context["__manager__"] = result.text
        if not manager_handoff:
            manager_handoff = self._runner._compact_text(result.text, self._runner.team.coordinator_context_max_chars)
        self._runner.task_handoffs["__manager__"] = manager_handoff
        self._runner.task_summaries["__manager__"] = manager_handoff
        self._runner.task_statuses.setdefault("__manager__", {})
        self._runner.task_statuses["__manager__"].update(
            {
                "status": result.status,
                "reason": "",
                "member_id": manager.id,
                "member_name": manager.name,
                "member_role": manager.role,
                "task_name": manager_task.name,
                "task_description": manager_task.description,
                "task_output": manager_task.output,
                "process": self._runner.team.process,
                "skills": self._runner._capability_lists(manager)[0],
                "tools": self._runner._capability_lists(manager)[1],
                "hierarchical": True,
                "manager": True,
                "rounds": result.rounds,
                "cost": result.cost,
                "tokens": dict(result.usage),
                "handoff": manager_handoff,
                **({"truncated": True} if result.truncated else {}),
                **({"structured": result.structured} if result.structured is not None else {}),
            }
        )

    def _manager_member(self, config: ExpertManagerConfig) -> ExpertMemberConfig:
        if config.member:
            for member in self._runner.team.members:
                if member.id == config.member:
                    return member
            raise RuntimeError(f"Manager member not found: {config.member}")

        return ExpertMemberConfig(
            id=_AUTO_MANAGER_ID,
            name="专家团经理",
            role="专家团经理",
            goal="Coordinate coworkers, delegate specialist work, and synthesize the final answer.",
            backstory="You manage the expert team for this run.",
            system_prompt=config.prompt,
            model=self._runner.request.model,
            provider_id=self._runner.request.provider_id,
            tools=[],
        )

    def _coworkers(self, manager: ExpertMemberConfig) -> list[ExpertMemberConfig]:
        return [member for member in self._runner.team.members if member.id != manager.id]

    def _manager_system_prompt(
        self,
        config: ExpertManagerConfig,
        manager: ExpertMemberConfig,
        coworkers: list[ExpertMemberConfig],
    ) -> str:
        roster = "\n".join(
            f"- {member.id}: {member.name} | role={member.role} | goal={member.goal}"
            for member in coworkers
        )
        prompt_parts = [part for part in [manager.system_prompt, config.prompt] if part]
        return "\n\n".join(
            [
                "\n\n".join(prompt_parts) if prompt_parts else config.prompt,
                f"You are {manager.name}, acting as {manager.role}.",
                "You have exactly two delegation tools: delegate_work and ask_coworker.",
                "Delegate concrete work to coworkers by id, name, or role. Do not invent coworkers.",
                "You must synthesize the final answer yourself after reviewing coworker outputs.",
                f"Maximum delegations for this run: {self._runner.team.max_delegations}.",
                "Available coworkers:\n" + roster,
            ]
        )

    def _manager_user_message(self, config: ExpertManagerConfig, coworkers: list[ExpertMemberConfig]) -> str:
        sections = [
            "Original user request:\n" + self._runner.request.input.strip(),
            "Workspace: " + (self._runner.request.workspace or "."),
        ]
        if self._runner.context.get("clarifications"):
            sections.append("User clarifications:\n" + self._runner.context["clarifications"])
        file_parts = self._runner._file_parts_for_attachments()
        if file_parts:
            sections.append(
                "Attached files:\n"
                + "\n".join(self._runner._format_attachment_for_context(part) for part in file_parts)
            )
        if config.submode == ExpertManagerSubmode.COORDINATED and self._runner.team.tasks:
            sections.append(
                "Suggested task plan. Treat it as a plan you may delegate and adapt:\n"
                + "\n".join(
                    f"- {task.id}: {task.name} | member={task.member} | task={task.task or task.description}"
                    for task in self._runner.team.tasks
                )
            )
        restored = self._restored_outputs_for_manager()
        if restored:
            sections.append(
                "Previously completed delegated work restored for this resumed run. Reuse it and do not repeat it unless the user explicitly asked to regenerate:\n"
                + restored
            )
        sections.append(
            "Use delegate_work for substantial coworker work. Use ask_coworker for focused clarification. "
            "When enough information is gathered, stop calling tools and write the final answer."
        )
        return "\n\n---\n\n".join(sections)

    def _tool_specs(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "delegate_work",
                    "description": "Delegate a concrete task to a coworker expert and return that coworker's output.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "coworker": {"type": "string", "description": "Coworker id, name, or role."},
                            "task": {"type": "string", "description": "Concrete work to perform."},
                            "context": {"type": "string", "description": "Useful context for the coworker."},
                            "expected_output": {"type": "string", "description": "Expected format or deliverable."},
                        },
                        "required": ["coworker", "task"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "ask_coworker",
                    "description": "Ask a coworker a focused question and return the answer.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "coworker": {"type": "string", "description": "Coworker id, name, or role."},
                            "question": {"type": "string", "description": "Question for the coworker."},
                            "context": {"type": "string", "description": "Relevant context."},
                        },
                        "required": ["coworker", "question"],
                    },
                },
            },
        ]

    async def _execute_synthetic_tool(
        self,
        name: str,
        args: dict[str, Any],
        call_id: str,
        message_id: str,
        messages: list[dict[str, Any]],
    ) -> str | None:
        if name not in {"delegate_work", "ask_coworker"}:
            return None
        part_id = generate_ulid()
        if self._runner.session_factory is not None:
            async with self._runner.session_factory() as db:
                async with db.begin():
                    await create_part(
                        db,
                        message_id=message_id,
                        session_id=self._runner.job.session_id,
                        part_id=part_id,
                        data={
                            "type": "tool",
                            "tool": name,
                            "call_id": call_id,
                            "state": {
                                "status": "running",
                                "input": args,
                                "output": None,
                                "metadata": None,
                                "title": None,
                                "time_start": None,
                                "time_end": None,
                                "time_compacted": None,
                            },
                        },
                    )
        self._runner.stream.tool_start(name, call_id, args)
        if self._delegation_count >= self._runner.team.max_delegations:
            output = (
                f"Delegation limit reached: max_delegations={self._runner.team.max_delegations}. "
                "Synthesize the final answer from completed coworker outputs."
            )
            await self._finalize_manager_tool_part(part_id, name, call_id, args, output, status="error")
            self._runner.stream.tool_result(name, call_id, output, metadata={"status": "error"})
            return output

        coworker_ref = str(args.get("coworker") or args.get("coworker_id") or "").strip()
        coworker = self._match_coworker(coworker_ref)
        if coworker is None:
            output = self._invalid_coworker_message(coworker_ref)
            await self._finalize_manager_tool_part(part_id, name, call_id, args, output, status="error")
            self._runner.stream.tool_result(name, call_id, output, metadata={"status": "error"})
            return output

        self._delegation_count += 1
        task_text = str(args.get("task") or args.get("question") or "").strip()
        if not task_text:
            return f"{name} requires a non-empty task or question."
        context = str(args.get("context") or "").strip()
        expected_output = str(args.get("expected_output") or "Return a concise, useful expert answer.").strip()
        if name == "ask_coworker":
            expected_output = "Answer the manager's question directly and cite any assumptions."

        task_id = f"delegation-{self._delegation_count}"
        synthetic_step = 1000 + self._delegation_count
        title = f"{coworker.role}: {task_id}"
        assistant_msg = f"hierarchical-{task_id}"
        if self._runner.session_factory is not None:
            assistant_msg = await self._runner._create_assistant_message(coworker)
        snapshot = {
            "step": synthetic_step,
            "title": title,
            "mode": "expert-team",
            "process": self._runner.team.process,
            "expert_team": self._runner.team.id,
            "member_id": coworker.id,
            "member_name": coworker.name,
            "member_role": coworker.role,
            "skills": self._runner._capability_lists(coworker)[0],
            "tools": self._runner._capability_lists(coworker)[1],
            "task_id": task_id,
            "task_name": f"委派任务 {self._delegation_count}",
            "status": "running",
            "hierarchical": True,
            "delegated_by": "manager",
            "delegation_index": self._delegation_count,
            "parent_message_id": message_id,
            "parent_tool_call_id": call_id,
        }
        if self._runner.session_factory is not None:
            await self._runner._persist_step_start(assistant_msg, snapshot)
        self._runner.stream.step_start(synthetic_step, title=title, message_id=assistant_msg, snapshot=snapshot)
        task = ExpertTaskConfig(
            id=task_id,
            name=f"委派任务 {self._delegation_count}",
            member=coworker.id,
            task=self._delegated_task_prompt(task_text, context),
            expected_output=expected_output,
            max_tool_rounds=self._runner.team.default_max_tool_rounds,
        )
        result = await self._runner.task_runner.run_task(
            synthetic_step,
            task,
            coworker,
            snapshot_extra={
                "hierarchical": True,
                "delegated_by": "manager",
                "delegation_index": self._delegation_count,
                "parent_message_id": message_id,
                "parent_tool_call_id": call_id,
                "process": self._runner.team.process,
                "skills": self._runner._capability_lists(coworker)[0],
                "tools": self._runner._capability_lists(coworker)[1],
            },
            record_output=True,
            message_id_override=assistant_msg,
        )
        handoff = self._runner._task_handoff_text(task.id, task.context_max_chars)
        if not handoff:
            handoff = self._runner._compact_text(result.text, self._runner._summary_limit_for_task(task))
        output = "\n".join(
            [
                f"Coworker: {coworker.name} ({coworker.role}, id={coworker.id})",
                f"Task: {task_text}",
                "Handoff:",
                handoff,
            ]
        )
        snapshot = {
            **snapshot,
            "status": result.status,
            "result_preview": self._runner._result_preview(result.text),
            "handoff": handoff,
            "tokens": dict(result.usage),
            "cost": result.cost,
            "rounds": result.rounds,
            "truncated": result.truncated,
        }
        if result.structured is not None:
            snapshot["structured"] = result.structured
        if self._runner.session_factory is not None:
            await self._runner._persist_step_finish(assistant_msg, "length" if result.truncated else "stop", snapshot)
        else:
            self._runner.stream.step_finish(
                reason="length" if result.truncated else "stop",
                tokens=snapshot["tokens"],
                cost=result.cost,
                message_id=assistant_msg,
                snapshot=snapshot,
            )
        await self._finalize_manager_tool_part(part_id, name, call_id, args, output, status="completed")
        self._runner.stream.tool_result(name, call_id, output, metadata={"status": "completed", "delegation_index": self._delegation_count})
        self._delegated_results.append(
            {
                "delegation_index": self._delegation_count,
                "coworker": coworker.id,
                "task": task_text,
                "output": result.text,
                "handoff": handoff,
                **({"structured": result.structured} if result.structured is not None else {}),
            }
        )
        return output

    def _delegated_task_prompt(self, task_text: str, context: str) -> str:
        sections = [
            "Manager delegated this task to you:",
            task_text,
            "Original user request:",
            self._runner.request.input.strip(),
        ]
        if context:
            sections.extend(["Manager-provided context:", context])
        if self._delegated_results:
            recent = self._delegated_results[-3:]
            sections.append(
                "Recent coworker outputs:\n"
                + "\n\n".join(
                    f"[{item['coworker']}] {item['task']}\n{item.get('handoff') or item['output']}"
                    for item in recent
                )
            )
        sections.append("Return your own expert output. Do not delegate further.")
        return "\n\n".join(sections)

    def _match_coworker(self, value: str) -> ExpertMemberConfig | None:
        normalized = self._normalize_ref(value)
        if not normalized:
            return None
        manager = self._manager_member(self._runner.team.manager or ExpertManagerConfig())
        coworkers = self._coworkers(manager)
        for member in coworkers:
            keys = {
                member.id,
                member.name,
                member.role,
                f"{member.name} {member.role}",
            }
            if any(self._normalize_ref(key) == normalized for key in keys):
                return member
        for member in coworkers:
            haystack = self._normalize_ref(" ".join([member.id, member.name, member.role]))
            if normalized in haystack:
                return member
        return None

    def _invalid_coworker_message(self, value: str) -> str:
        manager = self._manager_member(self._runner.team.manager or ExpertManagerConfig())
        coworkers = self._coworkers(manager)
        available = ", ".join(f"{member.id} ({member.name}/{member.role})" for member in coworkers)
        return f"Coworker not found: {value or '<empty>'}. Available coworkers: {available}"

    def _normalize_ref(self, value: str) -> str:
        return re.sub(r"[\s\"'`“”‘’]+", "", value or "").lower()

    def _restored_delegation_count(self) -> int:
        highest = 0
        for key, status in self._runner.task_statuses.items():
            if not isinstance(status, dict):
                continue
            if status.get("delegated_by") != "manager" and not status.get("delegated_by"):
                continue
            delegation_index = status.get("delegation_index")
            if isinstance(delegation_index, int):
                highest = max(highest, delegation_index)
                continue
            match = re.match(r"^delegation-(\d+)$", key)
            if match:
                highest = max(highest, int(match.group(1)))
        return highest

    def _restored_outputs_for_manager(self) -> str:
        sections: list[str] = []
        for key in getattr(self._runner, "_completed_output_order", []):
            if key == _AUTO_MANAGER_ID:
                continue
            status = self._runner.task_statuses.get(key, {})
            if not isinstance(status, dict):
                continue
            output = self._runner.task_outputs.get(key)
            if not output:
                continue
            if not status.get("hierarchical") and not status.get("delegated_by"):
                continue
            sections.append(
                "\n".join(
                    [
                        f"[{key}] {status.get('member_name') or status.get('member_id') or 'coworker'}",
                        f"Task: {status.get('task_name') or key}",
                        "Handoff:",
                        self._runner._task_handoff_text(key, self._runner.team.coordinator_context_max_chars)
                        or self._runner._compact_text(output, self._runner.team.coordinator_context_max_chars),
                    ]
                )
            )
        return "\n\n".join(sections)

    async def _finalize_manager_tool_part(
        self,
        part_id: str,
        tool_name: str,
        call_id: str,
        args: dict[str, Any],
        output: str,
        *,
        status: str,
    ) -> None:
        if self._runner.session_factory is None:
            return
        async with self._runner.session_factory() as db:
            async with db.begin():
                await update_part_data(
                    db,
                    part_id,
                    {
                        "type": "tool",
                        "tool": tool_name,
                        "call_id": call_id,
                        "state": {
                            "status": status,
                            "input": args,
                            "output": output,
                            "metadata": {"hierarchical": True},
                            "title": None,
                            "time_start": None,
                            "time_end": None,
                            "time_compacted": None,
                        },
                    },
                )
