"""Expert team runner that reuses Codata providers, tools, streams, and sessions."""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import re
import random
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.agent.permission import GLOBAL_DEFAULTS, evaluate, merge_rulesets, parse_session_permissions, presets_to_ruleset
from app.expert.adapters.llm import ExpertLLMAdapter
from app.expert.adapters.stream import ExpertStreamAdapter
from app.expert.adapters.tools import ExpertToolAdapter
from app.expert.executors import RunState, SequentialExecutor, TaskResult, WorkflowExecutor
from app.expert.executors.base import empty_usage
from app.expert.executors.task_runner import TaskRunner
from app.expert.models import (
    ExpertContextPolicy,
    ExpertDeliverableConfig,
    ExpertDeliverablePresentation,
    ExpertDeliverableType,
    ExpertFinalizationMode,
    ExpertInteractionMode,
    ExpertMemberConfig,
    ExpertOutputStyle,
    ExpertQuestionTimeoutAction,
    ExpertTaskConfig,
    ExpertTeamConfig,
    ExpertTeamProcess,
    ExpertTeamSummonRequest,
)
from app.expert.workflow import (
    ExpertWorkflowDAG,
    ExpertWorkflowNode,
    build_dag,
    dependencies_ready,
    evaluate_condition,
    render_template,
    reset_range,
    should_skip_for_dependencies,
)
from app.models.message import Message
from app.models.session_file import SessionFile
from app.provider.registry import ProviderRegistry
from app.session.manager import (
    build_user_content_with_files,
    create_message,
    create_part,
    create_session,
    get_session,
    update_part_data,
    update_session_title,
)
from app.session.utils import calculate_step_cost
from app.skill.registry import SkillRegistry
from app.streaming.events import AGENT_ERROR, DONE, QUESTION, SSEEvent
from app.streaming.manager import GenerationJob
from app.tool.context import ToolContext
from app.tool.registry import ToolRegistry
from app.utils.id import generate_ulid
from app.config import get_settings as _config_get_settings

logger = logging.getLogger(__name__)

LONG_RUNNING_TOOL_MIN_ROUNDS: dict[str, int] = {}

_DELIVERABLE_FINALIZATION_MAX_ATTEMPTS = 3
_FILE_TOOLS = frozenset({"read", "write", "edit"})
_COORDINATOR_ID = "coordinator"
_PREFLIGHT_TASK_ID = "preflight"
_MAX_RETRY_DELAY_SECONDS = 30.0
_DELIVERABLE_FILE_TOOLS = frozenset({"write", "edit", "present_file"})
_RAW_OUTPUT_PART_TYPE = "expert-raw-output"
_DELIVERABLE_REQUEST_TERMS = (
    "交付",
    "产物",
    "最终产物",
    "成品",
    "生成文件",
    "输出文件",
    "可下载",
    "附件",
    "文件",
    "网页",
    "页面",
    "html",
    "pdf",
    "word",
    "docx",
    "excel",
    "xlsx",
    "ppt",
    "pptx",
    "视频",
    "图片",
    "海报",
    "代码",
    "源码",
    "试题",
    "题库",
    "报告",
)
_ACTIVE_USAGE: contextvars.ContextVar[dict[str, int] | None] = contextvars.ContextVar(
    "expert_team_active_usage",
    default=None,
)


class ExpertTeamRunner:
    """Execute an expert team without changing the core chat agent loop."""

    def __init__(
        self,
        *,
        team: ExpertTeamConfig,
        request: ExpertTeamSummonRequest,
        job: GenerationJob,
        session_factory: async_sessionmaker[AsyncSession],
        provider_registry: ProviderRegistry,
        tool_registry: ToolRegistry,
        skill_registry: SkillRegistry | None = None,
        role_registry: Any | None = None,
        index_manager: Any | None = None,
        settings: Any | None = None,
    ) -> None:
        self.team = team
        self.request = request
        self.job = job
        self.session_factory = session_factory
        self.provider_registry = provider_registry
        self.tool_registry = tool_registry
        self.skill_registry = skill_registry
        self.role_registry = role_registry
        self.index_manager = index_manager
        self.settings = settings
        self.llm = ExpertLLMAdapter(provider_registry)
        self.tools = ExpertToolAdapter(tool_registry)
        self.stream = ExpertStreamAdapter(job)
        self.task_runner = TaskRunner(self)
        self.context: dict[str, str] = {}
        self.task_outputs: dict[str, str] = {}
        self.task_summaries: dict[str, str] = {}
        self.task_handoffs: dict[str, str] = {}
        self.task_statuses: dict[str, dict[str, Any]] = {}
        self._deliverable_outputs: list[dict[str, Any]] = []
        self._completed_output_order: list[str] = []
        self._attachment_file_parts: list[dict[str, Any]] | None = None
        self._allowed_file_paths: set[str] = set()
        self._resume_skip_task_ids: set[str] = set()
        # Analysis-memory section injected into member prompts for data teams.
        self._analysis_memory_section: str | None = None
        self.total_tokens: dict[str, int] = {
            "input": 0,
            "output": 0,
            "reasoning": 0,
            "cache_read": 0,
            "cache_write": 0,
        }
        self.total_cost = 0.0

    @property
    def run_state(self) -> RunState:
        return RunState(
            context=self.context,
            task_outputs=self.task_outputs,
            task_summaries=self.task_summaries,
            task_statuses=self.task_statuses,
            total_tokens=self.total_tokens,
            total_cost=self.total_cost,
        )

    async def run(self) -> None:
        """Run the configured expert team."""
        try:
            await self._prepare_session()
            self._prepare_context()
            if self.request.resume_from_task_id:
                await self._prepare_resume()
            else:
                await self._run_preflight_interaction()

            await self._load_analysis_memory()

            executor = self._executor_for_process()
            if executor is None:
                raise RuntimeError("Hierarchical expert teams are not supported in this build")
            await executor.execute()

            if not self.job.abort_event.is_set() and self.task_outputs:
                await self._run_finalization(len(self.team.tasks) + 1)

            finish_reason = "aborted" if self.job.abort_event.is_set() else "stop"
            self.stream.step_finish(reason=finish_reason, tokens=dict(self.total_tokens), cost=self.total_cost)
            self.job.publish(
                SSEEvent(
                    DONE,
                    {
                        "session_id": self.job.session_id,
                        "finish_reason": finish_reason,
                    },
                )
            )
        except Exception as exc:
            logger.exception("Expert team run failed")
            self.job.publish(SSEEvent(AGENT_ERROR, {"error_message": str(exc)}))
            self.job.publish(
                SSEEvent(
                    DONE,
                    {
                        "session_id": self.job.session_id,
                        "finish_reason": "error",
                    },
                )
            )
        finally:
            self.job.complete()

    def _executor_for_process(self):
        if self.team.process == ExpertTeamProcess.WORKFLOW:
            return WorkflowExecutor(self)
        if self.team.process == ExpertTeamProcess.SEQUENTIAL:
            return SequentialExecutor(self)
        if self.team.process == ExpertTeamProcess.HIERARCHICAL:
            from app.expert.executors.hierarchical import HierarchicalExecutor

            return HierarchicalExecutor(self)
        return None

    def _prepare_context(self) -> None:
        self.context = {
            "user_input": self.request.input.strip(),
            "input": self.request.input.strip(),
            "workspace": self.request.workspace or ".",
            "clarifications": "",
        }
        attachment_parts = self._file_parts_for_attachments()
        self.context["attachments"] = (
            "\n".join(self._format_attachment_for_context(part) for part in attachment_parts)
            if attachment_parts
            else "No attachments provided."
        )
        for item in self.team.inputs:
            if item.default is not None and not self._is_input_runtime_required(item):
                self.context[item.name] = item.default

    async def _prepare_resume(self) -> None:
        from_task_id = self.request.resume_from_task_id
        if not from_task_id:
            return
        task_ids = [task.id for task in self.team.tasks]
        if self.team.process == ExpertTeamProcess.HIERARCHICAL and from_task_id == "__manager__":
            self._resume_skip_task_ids = set()
            await self._load_completed_outputs_for_resume(restore_all=True)
            return
        if from_task_id not in task_ids:
            raise RuntimeError(f"Resume task not found: {from_task_id}")

        if self.team.process == ExpertTeamProcess.WORKFLOW:
            dag = build_dag(self.team)
            self._resume_skip_task_ids = self._upstream_task_ids(dag, from_task_id)
        else:
            resume_index = task_ids.index(from_task_id)
            self._resume_skip_task_ids = {task.id for task in self.team.tasks[:resume_index]}

        await self._load_completed_outputs_for_resume()

    def _upstream_task_ids(self, dag: ExpertWorkflowDAG, task_id: str) -> set[str]:
        upstream: set[str] = set()
        stack = [task_id]
        while stack:
            current_id = stack.pop()
            node = dag.nodes.get(current_id)
            if node is None:
                continue
            for dep_id in node.dependencies:
                if dep_id in upstream:
                    continue
                upstream.add(dep_id)
                stack.append(dep_id)
        return upstream

    async def _load_completed_outputs_for_resume(self, *, restore_all: bool = False) -> None:
        expected_restores = set(self._resume_skip_task_ids)
        restored_ids: set[str] = set()
        async with self.session_factory() as db:
            result = await db.execute(
                select(Message)
                .where(Message.session_id == self.job.session_id)
                .options(selectinload(Message.parts))
                .order_by(Message.time_created.asc())
            )
            messages = list(result.scalars().all())

            for msg in messages:
                data = msg.data or {}
                if data.get("mode") != "expert-team" or data.get("expert_team") != self.team.id:
                    continue
                text_parts: list[str] = []
                raw_output_parts: list[str] = []
                task_id = None
                result_preview = ""
                status = ""
                reason = ""
                snapshot: dict[str, Any] = {}
                for part in msg.parts:
                    part_data = part.data or {}
                    if part_data.get("type") == "text":
                        text_parts.append(str(part_data.get("text") or ""))
                        continue
                    if part_data.get("type") == _RAW_OUTPUT_PART_TYPE:
                        raw_output_parts.append(str(part_data.get("text") or ""))
                        continue
                    if part_data.get("type") != "step-finish":
                        continue
                    snapshot = part_data.get("snapshot") or {}
                    if snapshot.get("mode") != "expert-team":
                        continue
                    if snapshot.get("member_id") == _COORDINATOR_ID:
                        continue
                    task_id = str(snapshot.get("task_id") or "")
                    status = str(snapshot.get("status") or "")
                    reason = str(snapshot.get("reason") or "")
                    result_preview = str(snapshot.get("result_preview") or "")

                if not task_id or status not in {"completed", "truncated"}:
                    continue
                text = "".join(raw_output_parts or text_parts).strip()
                if not text:
                    text = result_preview.strip()
                should_restore = restore_all or task_id in expected_restores
                if not text or not should_restore:
                    continue

                task = next((item for item in self.team.tasks if item.id == task_id), None)
                restore_status = "truncated" if status == "truncated" else "completed"
                structured = snapshot.get("structured") if isinstance(snapshot.get("structured"), dict) else None
                if task is not None:
                    self._record_task_output(
                        task,
                        text,
                        status=restore_status,
                        reason=reason,
                        structured=structured,
                    )
                    self.task_statuses[task.id].update(
                        {
                            "restored": True,
                            "restored_partial": True,
                            "step": int(snapshot.get("step") or 0),
                            "member_id": str(snapshot.get("member_id") or task.member),
                            "member_name": str(snapshot.get("member_name") or ""),
                            "member_role": str(snapshot.get("member_role") or ""),
                            "task_name": str(snapshot.get("task_name") or task.name),
                            "task_description": str(snapshot.get("task_description") or task.description),
                            "task_output": str(snapshot.get("task_output") or task.output or ""),
                            "hierarchical": bool(snapshot.get("hierarchical")),
                            "delegated_by": str(snapshot.get("delegated_by") or ""),
                            "delegation_index": snapshot.get("delegation_index"),
                        }
                    )
                    restored_handoff = str(snapshot.get("handoff") or "").strip()
                    if restored_handoff:
                        self.task_handoffs[task.id] = restored_handoff
                        self.task_summaries[task.id] = restored_handoff
                        self.task_statuses[task.id]["handoff"] = restored_handoff
                    restored_ids.add(task.id)
                    continue

                if restore_all:
                    self._restore_unknown_task_output(
                        task_id,
                        text,
                        status=restore_status,
                        reason=reason,
                        snapshot=snapshot,
                        structured=structured,
                    )
                    restored_ids.add(task_id)

        missing = expected_restores - restored_ids
        for task_id in sorted(missing):
            logger.warning(
                "Expert team resume could not restore completed output for task '%s' in session '%s'",
                task_id,
                self.job.session_id,
            )
            self.task_statuses.setdefault(
                task_id,
                {
                    "status": "unknown",
                    "reason": "previous output could not be restored",
                    "restored_partial": True,
                },
            )

    def _file_parts_for_attachments(self) -> list[dict[str, Any]]:
        if self._attachment_file_parts is not None:
            return self._attachment_file_parts

        parts: list[dict[str, Any]] = []
        allowed_paths: set[str] = set()
        for att in self.request.attachments:
            part = {
                "type": "file",
                "file_id": att.get("file_id", ""),
                "name": att.get("name", ""),
                "path": att.get("path", ""),
                "size": att.get("size", 0),
                "mime_type": att.get("mime_type", ""),
                "source": att.get("source", "uploaded"),
                "content_hash": att.get("content_hash"),
            }
            parts.append(part)
            path = str(part.get("path") or "")
            if path:
                try:
                    resolved = Path(path).resolve()
                    if resolved.exists():
                        allowed_paths.add(str(resolved))
                except OSError:
                    logger.warning("Failed to resolve expert attachment path: %s", path)

        self._attachment_file_parts = parts
        self._allowed_file_paths = allowed_paths
        return parts

    def _format_attachment_for_context(self, part: dict[str, Any]) -> str:
        name = str(part.get("name") or "unnamed")
        path = str(part.get("path") or "")
        mime = str(part.get("mime_type") or "application/octet-stream")
        size = part.get("size") or 0
        return f"- {name} ({mime}, {size} bytes): {path}"

    async def _run_preflight_interaction(self) -> None:
        mode = self.team.interaction_mode
        if not isinstance(mode, ExpertInteractionMode):
            try:
                mode = ExpertInteractionMode(str(mode))
            except ValueError:
                mode = ExpertInteractionMode.AUTO

        decision: dict[str, Any] = {}
        if mode != ExpertInteractionMode.OFF and self.team.max_clarifying_questions > 0:
            decision = await self._llm_preflight_decision()

        await self._run_preflight_permission_checks(decision)

        blocking_questions = self._deterministic_preflight_questions(decision)
        if mode == ExpertInteractionMode.OFF and not blocking_questions:
            return

        questions = await self._preflight_questions(mode, blocking_questions=blocking_questions, decision=decision)
        if not questions or self.job.abort_event.is_set():
            return
        has_blocking_questions = self._has_blocking_preflight_questions(questions)
        if not self.job.interactive:
            if has_blocking_questions:
                raise RuntimeError(self._format_blocking_preflight_error(questions))
            self.context["clarifications"] = "非交互执行未补充预检信息，专家团将基于当前资料继续执行。"
            return

        title = "协调者: 资料预检"
        assistant_msg = await self._create_coordinator_message()
        snapshot = {
            "step": 0,
            "title": title,
            "mode": "expert-team",
            "process": self.team.process,
            "expert_team": self.team.id,
            "member_id": _COORDINATOR_ID,
            "member_name": "协调者",
            "member_role": "专家团协调者",
            "task_id": _PREFLIGHT_TASK_ID,
            "task_name": "资料预检",
            "status": "running",
            "reason": "等待用户补充关键信息",
        }
        await self._persist_step_start(assistant_msg, snapshot)
        self.stream.step_start(0, title=title, message_id=assistant_msg, snapshot=snapshot)

        call_id = generate_ulid()
        self.job.publish(
            SSEEvent(
                QUESTION,
                {
                    "call_id": call_id,
                    "session_id": self.job.session_id,
                    "questions": questions,
                    "source": "expert-team-preflight",
                    "expert_team": self.team.id,
                },
            )
        )

        try:
            response = await self.job.wait_for_response(call_id, timeout=float(self.team.question_timeout_seconds))
            if self._is_cancelled_response(response):
                raise TimeoutError("User cancelled clarification")
            answers = self._parse_preflight_answers(response, questions)
            clarification_text = self._format_preflight_answers(answers)
            self.context["clarifications"] = clarification_text
            input_answers = self._map_answers_to_inputs(answers, questions)
            for key, value in self._map_answers_to_question_context(answers, questions).items():
                if key in input_answers:
                    continue
                self.context[key] = value
            for key, value in input_answers.items():
                self.context[key] = value
            if self._missing_required_input_names() or self._missing_blocking_question_answers(answers, questions):
                raise TimeoutError("Required clarification was not provided")
            if clarification_text:
                await self._persist_text(assistant_msg, "用户补充信息：\n" + clarification_text)
            completed_snapshot = {
                **snapshot,
                "status": "completed",
                "reason": "用户已补充信息",
                "result_preview": clarification_text or "用户已确认继续执行。",
            }
            await self._persist_step_finish(assistant_msg, "stop", completed_snapshot)
        except TimeoutError:
            reason = "用户未在限定时间内补充信息"
            timeout_text = "用户未补充信息，专家团将基于当前资料和必要假设继续执行。"
            self.context["clarifications"] = timeout_text
            self._fill_missing_required_inputs(timeout_text)
            await self._persist_text(assistant_msg, timeout_text)
            if has_blocking_questions or self.team.on_question_timeout == ExpertQuestionTimeoutAction.FAIL_TASK:
                failed_snapshot = {**snapshot, "status": "failed", "reason": reason}
                await self._persist_step_finish(assistant_msg, "error", failed_snapshot)
                raise RuntimeError(reason)
            completed_snapshot = {
                **snapshot,
                "status": "completed",
                "reason": "超时后继续执行",
                "result_preview": timeout_text,
            }
            await self._persist_step_finish(assistant_msg, "stop", completed_snapshot)

    async def _preflight_questions(
        self,
        mode: ExpertInteractionMode,
        *,
        blocking_questions: list[dict[str, Any]] | None = None,
        decision: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        blocking_questions = blocking_questions or []
        decision = decision or {}
        required_questions = self._required_input_questions(blocking=True)
        if mode == ExpertInteractionMode.OFF:
            return self._select_preflight_questions([*blocking_questions, *required_questions])

        decision_questions = self._questions_from_preflight_decision(decision)
        if blocking_questions or required_questions or decision_questions:
            questions = [*blocking_questions, *required_questions, *decision_questions]
            return self._select_preflight_questions(questions)

        if mode == ExpertInteractionMode.ASK_FIRST:
            return self._select_preflight_questions(self._ask_first_preflight_questions())

        return []

    def _select_preflight_questions(self, questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped = self._dedupe_questions(questions)
        if not deduped:
            return []

        blocking = [item for item in deduped if item.get("blocking")]
        optional = [item for item in deduped if not item.get("blocking")]
        limit = max(0, self.team.max_clarifying_questions)
        if blocking:
            limit = max(limit, len(blocking))
        if limit <= 0:
            return []

        selected = list(blocking)
        for item in optional:
            if len(selected) >= limit:
                break
            selected.append(item)
        return selected

    def _required_input_questions(self, *, blocking: bool = False) -> list[dict[str, Any]]:
        questions: list[dict[str, Any]] = []
        for item in self.team.inputs:
            if not self._is_input_required(item):
                continue
            current = self.context.get(item.name)
            if current and str(current).strip():
                continue
            label = item.description or item.name
            question: dict[str, Any] = {
                "header": label[:18],
                "question": f"请补充「{label}」。",
                "input_key": item.name,
            }
            if blocking:
                question.update(
                    {
                        "blocking": True,
                        "required": True,
                        "reason": "missing_required_input",
                        "severity": "blocking",
                    }
                )
            options = self._input_options_for_question(item)
            if options:
                question["options"] = options
                question["multiSelect"] = False
            questions.append(question)
        return questions

    async def _run_preflight_permission_checks(self, decision: dict[str, Any] | None = None) -> None:
        """Check deterministic tool availability and permissions before experts start."""
        if self.tool_registry is None:
            return

        requirements = self._preflight_tool_requirements(decision)
        if not requirements:
            return

        missing: list[str] = []
        denied: list[str] = []
        ask_required: list[tuple[str, str]] = []
        ruleset = self._preflight_permission_ruleset()

        for tool_id, pattern in requirements:
            tool = self.tool_registry.get(tool_id) or self.tool_registry.get(tool_id.lower())
            if tool is None:
                missing.append(tool_id)
                continue
            action = evaluate(tool.id, pattern, ruleset)
            if action == "deny":
                denied.append(f"{tool.id} ({pattern})")
            elif action == "ask":
                ask_required.append((tool.id, pattern))

        if missing:
            raise RuntimeError("专家团缺少必要工具，无法开始执行：" + "、".join(sorted(set(missing))))
        if denied:
            raise RuntimeError("专家团缺少必要权限，无法开始执行：" + "、".join(sorted(set(denied))))

        if not self.job.interactive:
            return

        for tool_id, pattern in ask_required:
            allowed = await self._ask_permission(
                tool_id,
                generate_ulid(),
                {"reason": "专家团开始前需要确认必要工具权限", "preflight": True},
                pattern,
            )
            if not allowed:
                raise RuntimeError(f"用户未授权专家团使用必要工具：{tool_id}")

    def _preflight_permission_ruleset(self):
        return merge_rulesets(
            GLOBAL_DEFAULTS,
            self.tools.build_agent(name="expert-preflight", description=self.team.name, tools=[]).permissions,
            presets_to_ruleset(self.request.permission_presets),
            parse_session_permissions(self.request.permission_rules),
        )

    def _preflight_tool_requirements(self, decision: dict[str, Any] | None = None) -> list[tuple[str, str]]:
        requirements: list[tuple[str, str]] = []
        for member in self.team.members:
            for tool_id in member.tools:
                self._append_tool_requirement(requirements, tool_id)

        for tool_id in self.team.finalization.tools:
            self._append_tool_requirement(requirements, tool_id)

        mode = self.team.finalization.mode
        if mode == ExpertFinalizationMode.DELIVERABLE or self._should_force_deliverable_finalization(mode):
            deliverable = self._effective_deliverable_config()
            finalizer = self._finalizer_member_for_deliverable(deliverable)
            for tool_id in finalizer.tools:
                self._append_tool_requirement(requirements, tool_id)

        for tool_id in self._decision_required_tools(decision or {}):
            self._append_tool_requirement(requirements, tool_id)

        seen: set[tuple[str, str]] = set()
        unique: list[tuple[str, str]] = []
        for item in requirements:
            if item in seen:
                continue
            seen.add(item)
            unique.append(item)
        return unique

    def _append_tool_requirement(self, requirements: list[tuple[str, str]], tool_id: str) -> None:
        clean = str(tool_id or "").strip()
        if not clean:
            return
        requirements.append((clean, "*"))

    def _deterministic_preflight_questions(self, decision: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        questions: list[dict[str, Any]] = []
        questions.extend(self._missing_attachment_questions_from_decision(decision or {}))
        questions.extend(self._invalid_attachment_path_questions())
        questions.extend(self._missing_referenced_path_questions(decision or {}))
        return self._dedupe_questions(questions)

    def _input_options_for_question(self, item: Any) -> list[dict[str, Any]]:
        options: list[dict[str, Any]] = []
        for option in getattr(item, "options", []) or []:
            value = str(getattr(option, "value", None) or "").strip()
            display_label = str(getattr(option, "label", "") or value).strip()
            label = display_label or value
            if not label:
                continue
            clean: dict[str, Any] = {"label": label}
            description = str(getattr(option, "description", "") or "").strip()
            preview = str(getattr(option, "preview", "") or "").strip()
            if description:
                clean["description"] = description
            if preview:
                clean["preview"] = preview
            options.append(clean)
        return options

    def _ask_first_preflight_questions(self) -> list[dict[str, Any]]:
        return [
            {
                "header": "执行确认",
                "question": "请补充任何会影响专家团执行的关键背景、约束或最终交付标准；如果没有，请回复“按当前任务继续”。",
                "input_key": "preflight_notes",
            }
        ]

    def _missing_attachment_questions_from_decision(self, decision: dict[str, Any]) -> list[dict[str, Any]]:
        if self.request.attachments:
            return []
        if not self._decision_requires_attachments(decision):
            return []
        return [
            {
                "header": "资料",
                "question": "这次任务看起来需要参考文件、附件或资料，但当前没有可用附件。请上传/选择文件、提供可访问路径，或粘贴关键内容后再继续。",
                "input_key": "reference_materials",
                "blocking": True,
                "required": True,
                "reason": "missing_attachment",
                "severity": "blocking",
            }
        ]

    def _invalid_attachment_path_questions(self) -> list[dict[str, Any]]:
        invalid: list[str] = []
        for part in self._file_parts_for_attachments():
            name = str(part.get("name") or part.get("file_id") or "未命名附件")
            raw_path = str(part.get("path") or "").strip()
            if not raw_path:
                invalid.append(f"{name}: 缺少本地文件路径")
                continue
            resolved = self._resolve_user_file_path(raw_path)
            if not resolved.exists():
                invalid.append(f"{name}: {raw_path}")

        if not invalid:
            return []
        return [
            {
                "header": "附件路径",
                "question": "以下附件路径当前不可访问，请重新选择文件、提供正确路径，或粘贴关键内容后再继续：\n" + "\n".join(f"- {item}" for item in invalid),
                "input_key": "attachment_paths",
                "blocking": True,
                "required": True,
                "reason": "invalid_attachment_path",
                "severity": "blocking",
            }
        ]

    def _missing_referenced_path_questions(self, decision: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        missing: list[str] = []
        for raw_path in self._referenced_file_paths(decision):
            resolved = self._resolve_user_file_path(raw_path)
            if not resolved.exists():
                missing.append(raw_path)
        if not missing:
            return []
        return [
            {
                "header": "文件路径",
                "question": "你提供的以下文件路径当前不可访问，请确认路径是否正确、重新选择文件，或粘贴关键内容后再继续：\n"
                + "\n".join(f"- {item}" for item in missing),
                "input_key": "file_paths",
                "blocking": True,
                "required": True,
                "reason": "missing_referenced_file",
                "severity": "blocking",
            }
        ]

    def _referenced_file_paths(self, decision: dict[str, Any] | None = None) -> list[str]:
        text = self.request.input.strip()
        candidates: list[str] = []
        patterns = [
            r"(?<![\w:/.-])(?:~|/Users/|/Volumes/|/tmp/|/var/|/opt/)[^\s，。；;、)）\"']+",
            r"(?<![\w:/.-])(?:\.{1,2}/)?[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,12}",
        ]
        if text:
            for pattern in patterns:
                for match in re.finditer(pattern, text):
                    value = match.group(0).strip().strip(".,;:，。；：、)）]】\"'")
                    if not value or value.startswith(("http://", "https://")):
                        continue
                    if value not in candidates:
                        candidates.append(value)
        for value in self._decision_referenced_paths(decision or {}):
            if value and value not in candidates:
                candidates.append(value)
        return candidates

    def _resolve_user_file_path(self, raw_path: str) -> Path:
        path = Path(raw_path).expanduser()
        if path.is_absolute():
            return path.resolve()
        workspace = str(self.request.workspace or "").strip()
        base = Path(workspace).expanduser() if workspace else Path.cwd()
        return (base / path).resolve()

    def _has_blocking_preflight_questions(self, questions: list[dict[str, Any]]) -> bool:
        return any(bool(item.get("blocking")) for item in questions)

    def _missing_blocking_question_answers(
        self,
        answers: dict[str, str],
        questions: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        missing: list[dict[str, Any]] = []
        for item in questions:
            if not item.get("blocking"):
                continue
            question = str(item.get("question") or "")
            input_key = str(item.get("input_key") or "")
            if answers.get(question) or (input_key and answers.get(input_key)):
                continue
            missing.append(item)
        return missing

    def _format_blocking_preflight_error(self, questions: list[dict[str, Any]]) -> str:
        blocking = [item for item in questions if item.get("blocking")]
        if not blocking:
            return "专家团开始前需要补充信息。"
        details = "\n".join(f"- {item.get('question')}" for item in blocking if item.get("question"))
        return "专家团开始前需要用户补充或确认关键信息：\n" + details

    def _missing_required_input_names(self) -> list[str]:
        names: list[str] = []
        for item in self.team.inputs:
            if not self._is_input_required(item):
                continue
            value = self.context.get(item.name)
            if not value or not str(value).strip():
                names.append(item.name)
        return names

    def _is_input_required(self, item: Any) -> bool:
        return bool(getattr(item, "required", False)) or self._is_input_runtime_required(item)

    def _is_input_runtime_required(self, item: Any) -> bool:
        setting_name = str(getattr(item, "required_when_setting_missing", "") or "").strip()
        if not setting_name:
            return False
        settings = self._runtime_settings()
        if settings is None:
            return True
        value = getattr(settings, setting_name, None)
        return not str(value or "").strip()

    def _runtime_settings(self) -> Any | None:
        if self.settings is not None:
            return self.settings
        try:
            return _config_get_settings()
        except Exception:
            return None

    def _fill_missing_required_inputs(self, fallback: str) -> None:
        missing = set(self._missing_required_input_names())
        for item in self.team.inputs:
            if item.name not in missing:
                continue
            self.context[item.name] = self._default_input_fallback(item, fallback)

    def _default_input_fallback(self, item: Any, fallback: str) -> str:
        for option in getattr(item, "options", []) or []:
            value = str(getattr(option, "value", None) or getattr(option, "label", "") or "").strip()
            if value:
                return value
        return fallback

    def _is_cancelled_response(self, response: Any) -> bool:
        if isinstance(response, dict):
            return str(response.get("__cancelled__") or "").lower() == "true"
        try:
            parsed = json.loads(str(response))
        except json.JSONDecodeError:
            return False
        return isinstance(parsed, dict) and str(parsed.get("__cancelled__") or "").lower() == "true"

    async def _llm_preflight_decision(self) -> dict[str, Any]:
        prompt = "\n\n".join(
            [
                f"专家团：{self.team.name}",
                f"专家团说明：{self.team.description or '无'}",
                f"执行模式：{self.team.process}",
                f"最终交付配置：\n{self._preflight_deliverable_summary()}",
                "用户原始任务：\n" + self.request.input.strip(),
                "附件：\n" + (
                    "\n".join(self._format_attachment_for_context(part) for part in self._file_parts_for_attachments())
                    or "无"
                ),
                "任务列表：\n"
                + "\n".join(
                    f"- {task.name}: {task.task or task.description} | expected={task.expected_output}"
                    for task in self.team.tasks
                ),
                "团队输入：\n"
                + "\n".join(
                    f"- {item.name}: required={item.required}, description={item.description or item.name}"
                    for item in self.team.inputs
                ),
                "成员工具：\n"
                + "\n".join(
                    f"- {member.name}({member.id}): {', '.join(member.tools or []) or '无'}"
                    for member in self.team.members
                ),
                (
                    "请判断专家团是否可以开始执行。不要执行任务，只做前置判断。"
                    "只有当缺口会阻塞执行、明显影响最终产物正确性，或需要用户授权/确认风险时才提问。"
                    "可用合理假设解决的问题不要提问。"
                    "如果判断需要已有文件/附件/路径，必须明确 required_attachments=true 或 referenced_paths。"
                    "只输出 JSON，不要输出 Markdown。JSON schema："
                    "{"
                    '"decision":"continue|ask_user|blocked",'
                    '"reason":"ok|missing_context|missing_attachment|missing_path|risk_confirmation|permission|tooling",'
                    '"confidence":0.0,'
                    '"questions":[{"header":"短标题","question":"具体问题","input_key":"变量名","required":true,"blocking":true}],'
                    '"required_attachments":false,'
                    '"referenced_paths":["可选：用户给出的本地路径"],'
                    '"required_tools":["可选：开始前必须可用的工具 id"],'
                    '"risk_confirmations":["可选：需要用户确认的高风险动作"],'
                    '"assumptions":["可选：无需追问也可以采用的假设"]'
                    "}"
                ),
            ]
        )
        text = ""
        async for chunk in self.llm.stream(
            model=self.request.model,
            provider_id=self.request.provider_id,
            messages=[{"role": "user", "content": prompt}],
            system="你是专家团协调员，负责在长流程执行前做资料完整性预检。只输出 JSON。",
            tools=None,
            max_tokens=800,
            extra_body={"reasoning": {"enabled": False}},
        ):
            if self.job.abort_event.is_set():
                break
            if chunk.type == "text-delta":
                text += str(chunk.data.get("text") or "")
            elif chunk.type == "usage":
                self._accumulate_usage(chunk.data)
            elif chunk.type == "error":
                logger.warning("Expert preflight decision failed: %s", chunk.data.get("message"))
                return {}
        try:
            payload = self._extract_json_payload(text)
        except ValueError:
            logger.warning("Expert preflight decision returned invalid JSON: %s", text[:500])
            return {}
        return self._normalize_preflight_decision(payload)

    def _preflight_deliverable_summary(self) -> str:
        try:
            deliverable = self._effective_deliverable_config()
        except Exception:
            deliverable = None
        if deliverable is None:
            return "无明确最终产物配置"
        return json.dumps(
            {
                "mode": str(self.team.finalization.mode),
                "required": deliverable.required,
                "type": str(deliverable.type),
                "title": deliverable.title,
                "presentation": str(deliverable.presentation),
                "tools": list(deliverable.tools or []),
            },
            ensure_ascii=False,
        )

    def _normalize_preflight_decision(self, payload: dict[str, Any]) -> dict[str, Any]:
        decision = str(payload.get("decision") or "continue").strip().lower()
        if decision not in {"continue", "ask_user", "blocked"}:
            decision = "continue"
        confidence = payload.get("confidence", 0)
        try:
            confidence = max(0.0, min(1.0, float(confidence)))
        except (TypeError, ValueError):
            confidence = 0.0
        return {
            "decision": decision,
            "reason": str(payload.get("reason") or "ok").strip() or "ok",
            "confidence": confidence,
            "questions": payload.get("questions") if isinstance(payload.get("questions"), list) else [],
            "required_attachments": bool(payload.get("required_attachments")),
            "referenced_paths": self._string_list(payload.get("referenced_paths")),
            "required_tools": self._string_list(payload.get("required_tools")),
            "risk_confirmations": self._string_list(payload.get("risk_confirmations")),
            "assumptions": self._string_list(payload.get("assumptions")),
        }

    def _questions_from_preflight_decision(self, decision: dict[str, Any]) -> list[dict[str, Any]]:
        questions: list[dict[str, Any]] = []
        raw_questions = decision.get("questions")
        if not isinstance(raw_questions, list):
            raw_questions = []
        blocking_default = str(decision.get("decision") or "") in {"ask_user", "blocked"}
        for index, item in enumerate(raw_questions, start=1):
            if not isinstance(item, dict):
                continue
            question = str(item.get("question") or "").strip()
            if not question:
                continue
            blocking = bool(item.get("blocking", item.get("required", blocking_default)))
            questions.append(
                {
                    "header": str(item.get("header") or f"问题 {index}")[:18],
                    "question": question,
                    "input_key": str(item.get("input_key") or "").strip(),
                    "blocking": blocking,
                    "required": bool(item.get("required", blocking)),
                    "reason": str(item.get("reason") or decision.get("reason") or "missing_context"),
                    "severity": "blocking" if blocking else "normal",
                }
            )
        if not questions and str(decision.get("decision") or "") in {"ask_user", "blocked"}:
            reason = str(decision.get("reason") or "missing_context").strip() or "missing_context"
            questions.append(
                {
                    "header": "确认",
                    "question": f"前置判断认为当前信息不足或存在阻塞点（{reason}）。请补充关键条件，或明确确认可以基于现有信息继续。",
                    "input_key": "preflight_confirmation",
                    "blocking": True,
                    "required": True,
                    "reason": reason,
                    "severity": "blocking",
                }
            )
        if decision.get("risk_confirmations"):
            questions.append(
                {
                    "header": "确认",
                    "question": "继续执行前请确认这些风险动作是否允许：\n"
                    + "\n".join(f"- {item}" for item in self._string_list(decision.get("risk_confirmations"))),
                    "input_key": "risk_confirmation",
                    "blocking": True,
                    "required": True,
                    "reason": "risk_confirmation",
                    "severity": "blocking",
                }
            )
        return questions

    def _decision_requires_attachments(self, decision: dict[str, Any]) -> bool:
        return bool(decision.get("required_attachments"))

    def _decision_referenced_paths(self, decision: dict[str, Any]) -> list[str]:
        return self._string_list(decision.get("referenced_paths"))

    def _decision_required_tools(self, decision: dict[str, Any]) -> list[str]:
        return self._string_list(decision.get("required_tools"))

    def _string_list(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        result: list[str] = []
        for item in value:
            text = str(item or "").strip()
            if text and text not in result:
                result.append(text)
        return result

    def _dedupe_questions(self, questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        result: list[dict[str, Any]] = []
        for item in questions:
            question = str(item.get("question") or "").strip()
            if not question or question in seen:
                continue
            seen.add(question)
            clean = {
                "header": str(item.get("header") or f"问题 {len(result) + 1}")[:18],
                "question": question,
            }
            for key in ("blocking", "required", "reason", "severity"):
                if key in item:
                    clean[key] = item[key]
            input_key = str(item.get("input_key") or "").strip()
            if input_key:
                clean["input_key"] = input_key
            options = item.get("options")
            if isinstance(options, list):
                clean_options = self._question_options(options)
                if clean_options:
                    clean["options"] = clean_options
                    clean["multiSelect"] = bool(item.get("multiSelect"))
            result.append(clean)
        return result

    def _question_options(self, options: list[Any]) -> list[dict[str, Any]]:
        clean_options: list[dict[str, Any]] = []
        for option in options:
            if isinstance(option, str):
                label = option.strip()
                if label:
                    clean_options.append({"label": label})
                continue
            if not isinstance(option, dict):
                continue
            label = str(option.get("label") or option.get("value") or option.get("title") or "").strip()
            if not label:
                continue
            clean: dict[str, Any] = {"label": label}
            for key in ("description", "preview"):
                value = str(option.get(key) or "").strip()
                if value:
                    clean[key] = value
            clean_options.append(clean)
        return clean_options

    def _parse_preflight_answers(
        self,
        response: Any,
        questions: list[dict[str, Any]],
    ) -> dict[str, str]:
        if isinstance(response, dict):
            raw = response
        else:
            try:
                parsed = json.loads(str(response))
                raw = parsed if isinstance(parsed, dict) else {"补充信息": str(response)}
            except json.JSONDecodeError:
                raw = {"补充信息": str(response)}
        answers: dict[str, str] = {}
        for item in questions:
            question = str(item.get("question") or "")
            value = raw.get(question)
            if value is None:
                input_key = str(item.get("input_key") or "")
                value = raw.get(input_key)
            if value is None:
                continue
            answer = str(value).strip()
            if answer:
                answers[question] = answer
        if not answers:
            for key, value in raw.items():
                answer = str(value).strip()
                if answer:
                    answers[str(key)] = answer
        return answers

    def _map_answers_to_question_context(
        self,
        answers: dict[str, str],
        questions: list[dict[str, Any]],
    ) -> dict[str, str]:
        mapped: dict[str, str] = {}
        for item in questions:
            input_key = str(item.get("input_key") or "").strip()
            if not input_key:
                continue
            question = str(item.get("question") or "")
            value = answers.get(question) or answers.get(input_key)
            if value and str(value).strip():
                mapped[input_key] = str(value).strip()
        return mapped

    def _format_preflight_answers(self, answers: dict[str, str]) -> str:
        if not answers:
            return ""
        return "\n".join(f"- {question}\n  {answer}" for question, answer in answers.items())

    def _map_answers_to_inputs(
        self,
        answers: dict[str, str],
        questions: list[dict[str, Any]] | None = None,
    ) -> dict[str, str]:
        mapped: dict[str, str] = {}
        inputs_by_name = {item.name: item for item in self.team.inputs}
        for question_item in questions or []:
            input_key = str(question_item.get("input_key") or "").strip()
            input_item = inputs_by_name.get(input_key)
            if input_item is None:
                continue
            if input_item.name in self.context and self.context[input_item.name].strip():
                continue
            question = str(question_item.get("question") or "")
            answer = answers.get(question) or answers.get(input_key)
            if answer and str(answer).strip():
                mapped[input_item.name] = self._normalize_input_answer(input_item, str(answer))

        for item in self.team.inputs:
            if item.name in self.context and self.context[item.name].strip():
                continue
            if item.name in mapped:
                continue
            for question, answer in answers.items():
                label = item.description or item.name
                if item.name in question or label in question:
                    mapped[item.name] = self._normalize_input_answer(item, answer)
                    break
        return mapped

    def _normalize_input_answer(self, item: Any, answer: str) -> str:
        answer = answer.strip()
        for option in getattr(item, "options", []) or []:
            value = str(getattr(option, "value", None) or "").strip()
            label = str(getattr(option, "label", "") or "").strip()
            if answer and answer in {value, label}:
                return value or label or answer
        return answer

    def _extract_json_payload(self, text: str) -> dict[str, Any]:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.removeprefix("```json").removeprefix("```").strip()
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3].strip()
        try:
            payload = json.loads(cleaned)
        except json.JSONDecodeError:
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start < 0 or end <= start:
                raise ValueError("JSON object not found") from None
            payload = json.loads(cleaned[start:end + 1])
        if not isinstance(payload, dict):
            raise ValueError("JSON payload must be an object")
        return payload

    async def _run_workflow(
        self,
        *,
        team: ExpertTeamConfig | None = None,
        concurrency: int | None = None,
    ) -> None:
        execution_team = team or self.team
        dag = build_dag(execution_team)
        next_sequence = 1
        level_index = 0
        while level_index < len(dag.levels) and not self.job.abort_event.is_set():
            ready: list[ExpertWorkflowNode] = []
            for task_id in dag.levels[level_index]:
                node = dag.nodes[task_id]
                if node.task.id in self._resume_skip_task_ids:
                    restored = self.task_outputs.get(node.task.id, "")
                    node.status = "completed"
                    node.result = restored
                    self.task_statuses.setdefault(node.task.id, {"status": "completed", "reason": "restored from previous run"})
                    continue
                if node.status != "pending":
                    continue
                if should_skip_for_dependencies(node, dag.nodes):
                    await self._skip_node(node, next_sequence, "upstream dependency did not complete")
                    next_sequence += 1
                    continue
                if dependencies_ready(node, dag.nodes):
                    ready.append(node)

            if ready:
                semaphore = asyncio.Semaphore(max(1, concurrency or execution_team.concurrency))
                results = await asyncio.gather(
                    *[self._run_workflow_node(node, next_sequence + offset, semaphore) for offset, node in enumerate(ready)],
                    return_exceptions=True,
                )
                for node, result in zip(ready, results):
                    if isinstance(result, Exception):
                        node.status = "failed"
                        node.error = str(result)
                        logger.exception("Expert workflow task failed: %s", node.task.id, exc_info=result)
                next_sequence += len(ready)

            loop_target = await self._next_loop_target(dag, level_index)
            if loop_target is not None:
                level_index = loop_target
            else:
                level_index += 1

    async def _run_workflow_node(
        self,
        node: ExpertWorkflowNode,
        sequence: int,
        semaphore: asyncio.Semaphore,
    ) -> None:
        async with semaphore:
            if self.job.abort_event.is_set() or node.status != "pending":
                return
            node.sequence = sequence
            if node.task.condition:
                try:
                    if not evaluate_condition(node.task.condition, self.context):
                        await self._skip_node(node, sequence, "condition did not match")
                        return
                except Exception as exc:
                    await self._skip_node(node, sequence, f"condition error: {exc}")
                    return

            member = self._member_for_task(node.task)
            node.status = "running"
            try:
                result = await self.task_runner.run_task(sequence, node.task, member)
            except Exception as exc:
                node.status = "failed"
                node.error = str(exc)
                if node.task.id not in self.task_statuses:
                    await self._persist_failed_node(node, sequence, member, str(exc))
                raise

            if node.status != "failed":
                node.result = result.text
                node.status = "truncated" if result.truncated else "completed"

    async def _persist_failed_node(
        self,
        node: ExpertWorkflowNode,
        sequence: int,
        member: ExpertMemberConfig,
        error: str,
    ) -> None:
        title = f"{member.role}: {node.task.name}"
        assistant_msg = await self._create_assistant_message(member)
        snapshot = self._step_snapshot(
            step=sequence,
            title=title,
            member=member,
            task=node.task,
            status="failed",
            reason=error,
        )
        await self._persist_step_start(assistant_msg, snapshot)
        self.stream.step_start(sequence, title=title, message_id=assistant_msg, snapshot=snapshot)
        await self._persist_text(assistant_msg, f"Failed: {error}")
        await self._persist_step_finish(assistant_msg, "error", snapshot)
        self.task_statuses[node.task.id] = {"status": "failed", "reason": error}

    async def _skip_node(self, node: ExpertWorkflowNode, sequence: int, reason: str) -> None:
        node.status = "skipped"
        node.result = ""
        node.error = reason
        member = self._member_for_task(node.task)
        title = f"{member.role}: {node.task.name}"
        assistant_msg = await self._create_assistant_message(member)
        snapshot = self._step_snapshot(
            step=sequence,
            title=title,
            member=member,
            task=node.task,
            status="skipped",
            reason=reason,
        )
        await self._persist_step_start(assistant_msg, snapshot)
        self.stream.step_start(sequence, title=title, message_id=assistant_msg, snapshot=snapshot)
        await self._persist_text(assistant_msg, f"Skipped: {reason}")
        await self._persist_step_finish(assistant_msg, "skipped", snapshot)
        self.task_statuses[node.task.id] = {"status": "skipped", "reason": reason}

    async def _next_loop_target(self, dag: ExpertWorkflowDAG, level_index: int) -> int | None:
        for task_id in dag.levels[level_index]:
            node = dag.nodes[task_id]
            if node.status != "completed" or not node.task.loop:
                continue
            loop = node.task.loop
            try:
                should_exit = evaluate_condition(loop.exit_condition, self.context)
            except Exception as exc:
                logger.warning("Expert workflow loop condition failed for %s: %s", task_id, exc)
                should_exit = True
            if should_exit:
                self.context.pop("_loop_iteration", None)
                continue
            if node.iterations + 1 >= loop.max_iterations:
                self.context.pop("_loop_iteration", None)
                continue
            node.iterations += 1
            self.context["_loop_iteration"] = str(node.iterations + 1)
            target_level, reset_nodes = reset_range(dag, loop.back_to, task_id)
            for reset_node in reset_nodes:
                self.task_outputs.pop(reset_node.task.id, None)
                self.context.pop(reset_node.task.id, None)
                if reset_node.task.output:
                    self.context.pop(reset_node.task.output, None)
            return target_level
        return None

    async def _prepare_session(self) -> None:
        async with self.session_factory() as db:
            async with db.begin():
                session = await get_session(db, self.job.session_id)
                if session is None:
                    session = await create_session(
                        db,
                        id=self.job.session_id,
                        directory=self.request.workspace or ".",
                        title=self.request.input.strip()[:60] or self.team.name,
                        slug=f"expert-team:{self.team.id}",
                    )
                elif not session.slug:
                    session.slug = f"expert-team:{self.team.id}"
                await update_session_title(db, session.id, self.request.input.strip()[:60] or self.team.name)
                user_msg = await create_message(
                    db,
                    session_id=session.id,
                    data={"role": "user", "agent": "expert-team", "expert_team": self.team.id},
                )
                await create_part(
                    db,
                    message_id=user_msg.id,
                    session_id=session.id,
                    data={"type": "text", "text": self.request.input.strip()},
                )
                for att in self._file_parts_for_attachments():
                    await create_part(
                        db,
                        message_id=user_msg.id,
                        session_id=session.id,
                        data=att,
                    )

    def _member_for_task(self, task: ExpertTaskConfig) -> ExpertMemberConfig:
        for member in self.team.members:
            if member.id == task.member:
                return member
        raise RuntimeError(f"Expert member not found: {task.member}")

    async def _run_task(self, step: int, task: ExpertTaskConfig, member: ExpertMemberConfig) -> str:
        return (await self.task_runner.run_task(step, task, member)).text

    async def _run_task_impl(
        self,
        step: int,
        task: ExpertTaskConfig,
        member: ExpertMemberConfig,
        *,
        extra_tool_specs: list[dict[str, Any]] | None = None,
        synthetic_tool_executor: Any | None = None,
        snapshot_extra: dict[str, Any] | None = None,
        record_output: bool = True,
        system_override: str | None = None,
        messages_override: list[dict[str, Any]] | None = None,
        message_id_override: str | None = None,
    ) -> TaskResult:
        title = f"{member.role}: {task.name}"
        assistant_msg = message_id_override or await self._create_assistant_message(member)
        created_step_parts = message_id_override is None
        snapshot = self._step_snapshot(
            step=step,
            title=title,
            member=member,
            task=task,
            status="running",
        )
        if snapshot_extra:
            snapshot.update(snapshot_extra)
        if created_step_parts:
            await self._persist_step_start(assistant_msg, snapshot)
            self.stream.step_start(step, title=title, message_id=assistant_msg, snapshot=snapshot)

        system = system_override or self._build_system_prompt(member)
        messages = messages_override or self._build_messages(task)
        messages = self._messages_with_auto_loaded_skills(messages, member)
        agent = self.tools.build_agent(
            name=f"expert-{member.id}",
            description=member.role,
            tools=member.tools,
        )
        merged_rules = merge_rulesets(
            GLOBAL_DEFAULTS,
            agent.permissions,
            presets_to_ruleset(self.request.permission_presets),
            parse_session_permissions(self.request.permission_rules),
        )
        discovered_tools: set[str] = set()
        final_text = ""
        display_text = ""
        rounds = 0
        max_tool_rounds = self._max_tool_rounds_for_task(task, member)
        truncated = False
        last_round_had_tool_calls = False
        reached_round_limit = False
        usage = empty_usage()
        usage_token = _ACTIVE_USAGE.set(usage)
        error: Exception | None = None

        try:
            while rounds < max_tool_rounds and not self.job.abort_event.is_set():
                rounds += 1
                tool_specs = self.tools.specs(agent, merged_rules, discovered_tools)
                if extra_tool_specs:
                    tool_specs = [*tool_specs, *extra_tool_specs]
                text, tool_calls, finish_reason = await self._stream_once_with_retry(
                    task=task,
                    member=member,
                    message_id=assistant_msg,
                    system=system,
                    messages=messages,
                    tools=tool_specs,
                )
                if text:
                    final_text += text

                if not tool_calls:
                    last_round_had_tool_calls = False
                    if text:
                        messages.append({"role": "assistant", "content": text})
                    break

                assistant_tool_msg = {"role": "assistant", "content": text or "", "tool_calls": []}
                for call in tool_calls:
                    call_id = str(call.get("id") or generate_ulid())
                    call["id"] = call_id
                    name = call.get("name", "")
                    args = call.get("arguments", {}) if isinstance(call.get("arguments"), dict) else {}
                    assistant_tool_msg["tool_calls"].append(
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(args)},
                        }
                    )
                messages.append(assistant_tool_msg)
                last_round_had_tool_calls = bool(tool_calls)

                for call in tool_calls:
                    if self.job.abort_event.is_set():
                        break
                    output = await self._execute_tool(
                        message_id=assistant_msg,
                        member=member,
                        agent=agent,
                        ruleset=merged_rules,
                        discovered_tools=discovered_tools,
                        tool_call=call,
                        messages=messages,
                        synthetic_tool_executor=synthetic_tool_executor,
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.get("id"),
                            "content": output,
                        }
                    )

                if finish_reason != "tool_calls":
                    break
                if rounds >= max_tool_rounds:
                    reached_round_limit = True
        except Exception as exc:
            error = exc
        finally:
            _ACTIVE_USAGE.reset(usage_token)

        if error is not None:
            cost = self._cost_for_usage(usage, member)
            self._add_run_usage(usage, cost)
            failed_snapshot = self._step_snapshot(
                step=step,
                title=title,
                member=member,
                task=task,
                status="failed",
                reason=str(error),
            )
            failed_snapshot["result_preview"] = self._result_preview(final_text)
            failed_snapshot["tokens"] = dict(usage)
            failed_snapshot["cost"] = cost
            if snapshot_extra:
                failed_snapshot.update(snapshot_extra)
            self.task_statuses[task.id] = self._task_status_payload(
                task,
                member,
                status="failed",
                reason=str(error),
                extra=snapshot_extra,
            )
            await self._persist_text(assistant_msg, f"\n\nFailed: {error}")
            await self._persist_step_finish(assistant_msg, "error", failed_snapshot)
            raise error

        final_text = final_text.strip()
        display_text = final_text
        structured: dict[str, Any] | None = None
        if task.output_schema:
            try:
                structured = await self._ensure_structured_output(
                    task=task,
                    member=member,
                    current_text=final_text,
                    messages=messages,
                    system=system,
                    message_id=assistant_msg,
                    usage=usage,
                )
                final_text = json.dumps(structured, ensure_ascii=False, separators=(",", ":"))
                display_text = final_text
            except Exception as exc:
                error = exc

        if error is not None:
            cost = self._cost_for_usage(usage, member)
            self._add_run_usage(usage, cost)
            failed_snapshot = self._step_snapshot(
                step=step,
                title=title,
                member=member,
                task=task,
                status="failed",
                reason=str(error),
            )
            failed_snapshot["result_preview"] = self._result_preview(final_text)
            failed_snapshot["tokens"] = dict(usage)
            failed_snapshot["cost"] = cost
            if snapshot_extra:
                failed_snapshot.update(snapshot_extra)
            self.task_statuses[task.id] = self._task_status_payload(
                task,
                member,
                status="failed",
                reason=str(error),
                extra=snapshot_extra,
            )
            await self._persist_text(assistant_msg, f"\n\nFailed: {error}")
            await self._persist_step_finish(assistant_msg, "error", failed_snapshot)
            raise error

        if not self.job.abort_event.is_set() and reached_round_limit and last_round_had_tool_calls:
            truncated = True

        visible_text = self._visible_task_output(
            task,
            final_text,
            member=member,
            structured=structured,
            finalization_mode=bool(snapshot_extra and snapshot_extra.get("finalization_mode")),
        )
        if visible_text:
            await self._persist_raw_and_visible_text(assistant_msg, final_text, visible_text)
            self.stream.text(assistant_msg, visible_text)
            display_text = visible_text

        if truncated:
            notice = (
                f"\n\n[Expert task truncated: reached max_tool_rounds={max_tool_rounds} "
                "while tool calls may still be pending.]"
            )
            display_text = display_text + notice
            await self._persist_text(assistant_msg, notice)

        status = "truncated" if truncated else "completed"
        if record_output:
            self._record_task_output(task, final_text, status=status, structured=structured)
        cost = self._cost_for_usage(usage, member)
        self._add_run_usage(usage, cost)
        completed_snapshot = self._step_snapshot(
            step=step,
            title=title,
            member=member,
            task=task,
            status=status,
        )
        completed_snapshot["result_preview"] = self._result_preview(display_text)
        completed_snapshot["tokens"] = dict(usage)
        completed_snapshot["cost"] = cost
        completed_snapshot["rounds"] = rounds
        completed_snapshot["truncated"] = truncated
        if structured is not None:
            completed_snapshot["structured"] = structured
        if record_output and task.id in self.task_handoffs:
            completed_snapshot["handoff"] = self.task_handoffs[task.id]
        if snapshot_extra:
            completed_snapshot.update(snapshot_extra)
        self.task_statuses[task.id] = self._task_status_payload(
            task,
            member,
            status=status,
            structured=structured,
            truncated=truncated,
            extra=snapshot_extra,
        )
        if not record_output:
            self._mark_completed_output(task.id)
        if created_step_parts:
            await self._persist_step_finish(
                assistant_msg,
                "length" if truncated else "stop",
                completed_snapshot,
            )
        return TaskResult(
            text=final_text,
            structured=structured,
            usage=dict(usage),
            cost=cost,
            status=status,
            rounds=rounds,
            truncated=truncated,
        )

    def _max_tool_rounds_for_task(self, task: ExpertTaskConfig, member: ExpertMemberConfig) -> int:
        configured = int(task.max_tool_rounds or self.team.default_max_tool_rounds)
        task_text = "\n".join(
            part
            for part in [
                task.task or "",
                task.description,
                task.expected_output,
                task.name,
            ]
            if part
        )
        for tool_id, minimum in LONG_RUNNING_TOOL_MIN_ROUNDS.items():
            if tool_id in member.tools or tool_id in task_text:
                configured = max(configured, minimum)
        return max(1, min(30, configured))

    def _record_task_output(
        self,
        task: ExpertTaskConfig,
        output: str,
        *,
        status: str,
        reason: str = "",
        structured: dict[str, Any] | None = None,
    ) -> None:
        handoff = json.dumps(structured, ensure_ascii=False, separators=(",", ":")) if structured is not None else output
        handoff_summary = self._build_task_handoff(task, handoff, structured=structured)
        self.task_outputs[task.id] = output
        self.context[task.id] = handoff
        self.task_handoffs[task.id] = handoff_summary
        self.task_summaries[task.id] = handoff_summary
        member = next((item for item in self.team.members if item.id == task.member), None)
        task_status = self._task_status_payload(
            task,
            member,
            status=status,
            reason=reason,
            structured=structured,
            truncated=status == "truncated",
        )
        task_status["handoff"] = handoff_summary
        self.task_statuses[task.id] = task_status
        if task.output:
            self.context[task.output] = handoff
        self._mark_completed_output(task.id)

    def _task_status_payload(
        self,
        task: ExpertTaskConfig,
        member: ExpertMemberConfig | None,
        *,
        status: str,
        reason: str = "",
        structured: dict[str, Any] | None = None,
        truncated: bool = False,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        skills, tools = self._capability_lists(member)
        payload: dict[str, Any] = {
            "status": status,
            "reason": reason,
            "member_id": member.id if member else task.member,
            "member_name": member.name if member else task.member,
            "member_role": member.role if member else task.member,
            "task_name": task.name,
            "task_description": task.description,
            "task_output": task.output,
            "process": str(self.team.process),
            "skills": skills,
            "tools": tools,
        }
        if structured is not None:
            payload["structured"] = structured
        if truncated:
            payload["truncated"] = True
        if extra:
            payload.update(extra)
        return payload

    def _build_task_handoff(
        self,
        task: ExpertTaskConfig,
        handoff: str,
        *,
        structured: dict[str, Any] | None = None,
    ) -> str:
        if structured is not None:
            return self._compact_text(
                json.dumps(structured, ensure_ascii=False, separators=(",", ":")),
                self._summary_limit_for_task(task),
            )

        text = handoff.strip()
        if not text:
            return ""
        limit = self._summary_limit_for_task(task)
        if len(text) <= limit:
            return text

        extracted = self._extract_handoff_sections(text)
        if extracted:
            return self._compact_text(extracted, limit)

        return self._compact_text(text, limit)

    def _extract_handoff_sections(self, text: str) -> str:
        headings = (
            "handoff",
            "交接",
            "交接摘要",
            "摘要",
            "结论",
            "关键结论",
            "关键事实",
            "决策",
            "约束",
            "风险",
            "待处理",
            "下一步",
            "产物",
            "文件",
        )
        lines = [line.rstrip() for line in text.splitlines()]
        selected: list[str] = []
        keep = False
        for line in lines:
            stripped = line.strip()
            heading_text = stripped.lstrip("#*-0123456789.、:： ").strip().lower()
            is_heading = bool(stripped) and any(keyword in heading_text for keyword in headings) and len(stripped) <= 80
            if is_heading:
                keep = True
            elif keep and stripped and not line.startswith((" ", "\t")) and len(stripped) <= 80:
                next_heading = any(keyword in heading_text for keyword in headings)
                if not next_heading and stripped.endswith(("：", ":")):
                    next_heading = True
                if not next_heading:
                    keep = False
            if keep and stripped:
                selected.append(line)
            if len("\n".join(selected)) > 5000:
                break
        return "\n".join(selected).strip()

    def _task_handoff_text(self, task_id: str, limit: int) -> str:
        handoff = self.task_handoffs.get(task_id)
        if not handoff:
            status = self.task_statuses.get(task_id)
            if isinstance(status, dict):
                handoff = str(status.get("handoff") or "").strip()
        if not handoff:
            handoff = self.task_summaries.get(task_id)
        if not handoff:
            handoff = self.task_outputs.get(task_id, "")
        return self._compact_text(handoff, limit) if handoff else ""

    async def _ensure_structured_output(
        self,
        *,
        task: ExpertTaskConfig,
        member: ExpertMemberConfig,
        current_text: str,
        messages: list[dict[str, Any]],
        system: str,
        message_id: str,
        usage: dict[str, int],
    ) -> dict[str, Any]:
        schema = task.output_schema or {}
        attempts = max(1, task.retry_count + 1)
        text = current_text
        last_error = ""
        for attempt in range(attempts):
            try:
                payload = self._extract_json_payload(text)
                self._validate_output_schema(payload, schema)
                return payload
            except Exception as exc:
                last_error = str(exc)

            if self.job.abort_event.is_set() or attempt >= attempts - 1:
                break

            repair_messages = [
                *messages,
                {
                    "role": "assistant",
                    "content": text,
                },
                {
                    "role": "user",
                    "content": (
                        "The previous answer did not satisfy the required JSON schema. "
                        "Return only one JSON object, with no Markdown or commentary.\n\n"
                        f"Schema:\n{json.dumps(schema, ensure_ascii=False)}\n\n"
                        f"Validation error:\n{last_error}"
                    ),
                },
            ]
            repair_text = ""
            repair_usage = empty_usage()
            usage_token = _ACTIVE_USAGE.set(repair_usage)
            try:
                repair_text, _tool_calls, _finish = await self._stream_once_with_retry(
                    task=task,
                    member=member,
                    message_id=message_id,
                    system=system,
                    messages=repair_messages,
                    tools=None,
                    response_format={"type": "json_object"},
                )
            finally:
                _ACTIVE_USAGE.reset(usage_token)
            for key in usage:
                usage[key] += int(repair_usage.get(key, 0))
            if repair_text:
                await self._persist_text(message_id, repair_text)
            text = repair_text.strip()

        raise RuntimeError(f"Task '{task.id}' output did not match output_schema: {last_error or 'invalid JSON'}")

    def _validate_output_schema(self, payload: Any, schema: dict[str, Any]) -> None:
        """Validate task output against JSON Schema."""
        try:
            from jsonschema import Draft202012Validator
            from jsonschema.exceptions import SchemaError
        except Exception:
            logger.warning("jsonschema is not installed; falling back to limited output_schema validation")
            self._validate_schema_node(payload, schema or {}, path="$")
            return

        try:
            validator = Draft202012Validator(schema or {})
            validator.check_schema(schema or {})
            errors = sorted(validator.iter_errors(payload), key=lambda item: list(item.absolute_path))
        except SchemaError as exc:
            raise ValueError(f"Invalid output_schema: {exc.message}") from exc
        if not errors:
            return

        first = errors[0]
        location = "$"
        if first.absolute_path:
            location += "".join(
                f"[{part}]" if isinstance(part, int) else f".{part}"
                for part in first.absolute_path
            )
        raise ValueError(f"{location}: {first.message}")

    def _validate_schema_node(self, value: Any, schema: dict[str, Any], *, path: str) -> None:
        """Fallback validator used only when jsonschema is unavailable."""
        if not isinstance(schema, dict):
            return
        for keyword in ("allOf", "anyOf", "oneOf"):
            candidates = schema.get(keyword)
            if not isinstance(candidates, list):
                continue
            matches = 0
            last_error = ""
            for child in candidates:
                if not isinstance(child, dict):
                    continue
                try:
                    self._validate_schema_node(value, child, path=path)
                    matches += 1
                except ValueError as exc:
                    last_error = str(exc)
            if keyword == "allOf" and matches != len([item for item in candidates if isinstance(item, dict)]):
                raise ValueError(last_error or f"{path} must match all schemas")
            if keyword == "anyOf" and matches == 0:
                raise ValueError(last_error or f"{path} must match one allowed schema")
            if keyword == "oneOf" and matches != 1:
                raise ValueError(f"{path} must match exactly one allowed schema")

        expected_type = schema.get("type")
        if expected_type:
            expected_types = expected_type if isinstance(expected_type, list) else [expected_type]
            if not any(self._json_type_matches(value, item) for item in expected_types):
                raise ValueError(f"{path} must be {expected_type}")

        enum_values = schema.get("enum")
        if isinstance(enum_values, list) and value not in enum_values:
            raise ValueError(f"{path} must be one of {enum_values}")

        if isinstance(value, dict):
            required = schema.get("required") if isinstance(schema.get("required"), list) else []
            for key in required:
                if key not in value:
                    raise ValueError(f"{path}.{key} is required")
            properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
            if schema.get("additionalProperties") is False:
                extra_keys = sorted(set(value) - set(properties))
                if extra_keys:
                    raise ValueError(f"Additional properties are not allowed at {path}: {', '.join(extra_keys)}")
            for key, child_schema in properties.items():
                if key in value and isinstance(child_schema, dict):
                    self._validate_schema_node(value[key], child_schema, path=f"{path}.{key}")
        elif isinstance(value, str):
            min_length = schema.get("minLength")
            max_length = schema.get("maxLength")
            pattern = schema.get("pattern")
            if isinstance(min_length, int) and len(value) < min_length:
                raise ValueError(f"{path} length must be at least {min_length}")
            if isinstance(max_length, int) and len(value) > max_length:
                raise ValueError(f"{path} length must be at most {max_length}")
            if isinstance(pattern, str) and not re.search(pattern, value):
                raise ValueError(f"{path} must match pattern {pattern}")
        elif isinstance(value, list):
            min_items = schema.get("minItems")
            max_items = schema.get("maxItems")
            if isinstance(min_items, int) and len(value) < min_items:
                raise ValueError(f"{path} must contain at least {min_items} items")
            if isinstance(max_items, int) and len(value) > max_items:
                raise ValueError(f"{path} must contain at most {max_items} items")
            item_schema = schema.get("items")
            if isinstance(item_schema, dict):
                for index, item in enumerate(value):
                    self._validate_schema_node(item, item_schema, path=f"{path}[{index}]")
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            minimum = schema.get("minimum")
            maximum = schema.get("maximum")
            exclusive_minimum = schema.get("exclusiveMinimum")
            exclusive_maximum = schema.get("exclusiveMaximum")
            if isinstance(minimum, (int, float)) and value < minimum:
                raise ValueError(f"{path} must be >= {minimum}")
            if isinstance(maximum, (int, float)) and value > maximum:
                raise ValueError(f"{path} must be <= {maximum}")
            if isinstance(exclusive_minimum, (int, float)) and value <= exclusive_minimum:
                raise ValueError(f"{path} must be > {exclusive_minimum}")
            if isinstance(exclusive_maximum, (int, float)) and value >= exclusive_maximum:
                raise ValueError(f"{path} must be < {exclusive_maximum}")

    def _json_type_matches(self, value: Any, expected_type: Any) -> bool:
        if expected_type == "object":
            return isinstance(value, dict)
        if expected_type == "array":
            return isinstance(value, list)
        if expected_type == "string":
            return isinstance(value, str)
        if expected_type == "number":
            return isinstance(value, (int, float)) and not isinstance(value, bool)
        if expected_type == "integer":
            return isinstance(value, int) and not isinstance(value, bool)
        if expected_type == "boolean":
            return isinstance(value, bool)
        if expected_type == "null":
            return value is None
        return True

    async def _run_coordinator(self, step: int) -> None:
        title = "协调者: 汇总交付"
        assistant_msg = await self._create_coordinator_message()
        coordinator_member = ExpertMemberConfig(
            id=_COORDINATOR_ID,
            name="协调者",
            role="专家团协调者",
            goal=self.team.coordinator_prompt,
        )
        coordinator_task = ExpertTaskConfig(
            id="final",
            name="汇总交付",
            member=_COORDINATOR_ID,
            task="综合专家团产出，形成最终交付。",
            expected_output="面向用户的最终答复。",
        )
        snapshot = {
            "step": step,
            "title": title,
            "mode": "expert-team",
            "expert_team": self.team.id,
            "member_id": _COORDINATOR_ID,
            "member_name": "协调者",
            "member_role": "专家团协调者",
            "task_id": "final",
            "task_name": "汇总交付",
            "status": "running",
        }
        await self._persist_step_start(assistant_msg, snapshot)
        self.stream.step_start(step, title=title, message_id=assistant_msg, snapshot=snapshot)

        text = ""
        usage = empty_usage()
        usage_token = _ACTIVE_USAGE.set(usage)
        error: Exception | None = None
        try:
            async for chunk in self.llm.stream(
                model=self.request.model,
                provider_id=self.request.provider_id,
                messages=self._build_coordinator_messages(),
                system=self._build_coordinator_prompt(),
                tools=None,
                extra_body={"reasoning": {"enabled": False}} if self.request.reasoning is False else None,
            ):
                if self.job.abort_event.is_set():
                    break
                if chunk.type == "text-delta":
                    delta = str(chunk.data.get("text") or "")
                    text += delta
                elif chunk.type == "usage":
                    self._accumulate_usage(chunk.data)
                elif chunk.type == "error":
                    raise RuntimeError(str(chunk.data.get("message") or "LLM stream error"))
        except Exception as exc:
            error = exc
        finally:
            _ACTIVE_USAGE.reset(usage_token)

        if error is not None:
            raise error

        text = text.strip()
        visible_text = self._visible_task_output(
            coordinator_task,
            text,
            member=coordinator_member,
            structured=None,
            finalization_mode=True,
        )
        if text:
            await self._persist_raw_and_visible_text(assistant_msg, text, visible_text)
        if visible_text:
            self.stream.text(assistant_msg, visible_text)

        completed_snapshot = {**snapshot, "status": "completed"}
        completed_snapshot["result_preview"] = self._result_preview(visible_text or text)
        completed_snapshot["tokens"] = dict(usage)
        completed_snapshot["cost"] = self._cost_for_usage(usage, coordinator_member)
        self._add_run_usage(usage, completed_snapshot["cost"])
        await self._persist_step_finish(
            assistant_msg,
            "stop",
            completed_snapshot,
        )

    async def _run_finalization(self, step: int) -> None:
        mode = self.team.finalization.mode
        if not isinstance(mode, ExpertFinalizationMode):
            try:
                mode = ExpertFinalizationMode(str(mode))
            except ValueError:
                mode = ExpertFinalizationMode.COORDINATOR

        if mode != ExpertFinalizationMode.DELIVERABLE and self._should_force_deliverable_finalization(mode):
            await self._run_deliverable_finalization(step)
            return

        if mode == ExpertFinalizationMode.NONE:
            return
        if mode == ExpertFinalizationMode.LAST_TASK:
            await self._persist_last_task_finalization(step)
            return
        if mode == ExpertFinalizationMode.DELIVERABLE:
            await self._run_deliverable_finalization(step)
            return
        await self._run_configured_coordinator(step)

    async def _persist_last_task_finalization(self, step: int) -> None:
        task = self._last_completed_task()
        if task is None:
            return
        text = self.task_outputs.get(task.id, "")
        if not text:
            return
        member = self._hierarchical_member_for_task(task) if task.id == "__manager__" else self._member_for_task(task)
        visible_text = self._visible_task_output(
            task,
            text,
            member=member,
            structured=None,
            finalization_mode=True,
        )
        title = "最终交付"
        if self.session_factory is not None:
            assistant_msg = await self._create_coordinator_message()
        else:
            assistant_msg = f"finalization-{step}"
        snapshot = {
            "step": step,
            "title": title,
            "mode": "expert-team",
            "process": self.team.process,
            "expert_team": self.team.id,
            "member_id": member.id,
            "member_name": member.name,
            "member_role": member.role,
            "task_id": task.id,
            "task_name": task.name,
            "status": "completed",
            "finalization_mode": "last_task",
            "result_preview": self._result_preview(visible_text),
            "tokens": empty_usage(),
            "cost": 0.0,
        }
        if self.session_factory is not None:
            await self._persist_step_start(assistant_msg, snapshot)
        self.stream.step_start(step, title=title, message_id=assistant_msg, snapshot=snapshot)
        if self.session_factory is not None:
            await self._persist_raw_and_visible_text(assistant_msg, text, visible_text)
        self.stream.text(assistant_msg, visible_text)
        if self.session_factory is not None:
            await self._persist_step_finish(assistant_msg, "stop", snapshot)
        else:
            self.stream.step_finish(reason="stop", tokens=snapshot["tokens"], cost=0.0, message_id=assistant_msg, snapshot=snapshot)

    async def _run_configured_coordinator(self, step: int) -> None:
        if not self.team.finalization.tools and not self.team.finalization.member:
            await self._run_coordinator(step)
            return

        member = self._finalizer_member()
        task = ExpertTaskConfig(
            id="final",
            name="汇总交付",
            member=member.id,
            task=self._build_coordinator_messages()[0]["content"],
            expected_output="综合专家团产出，形成最终交付。",
            max_tool_rounds=self.team.default_max_tool_rounds,
        )
        finalizer = member.model_copy(update={"tools": list(self.team.finalization.tools or member.tools)})
        await self.task_runner.run_task(
            step,
            task,
            finalizer,
            system_override=self._build_coordinator_prompt(),
            messages_override=self._build_coordinator_messages(),
            snapshot_extra={"finalization_mode": "coordinator"},
            record_output=True,
        )

    def _should_force_deliverable_finalization(self, mode: ExpertFinalizationMode) -> bool:
        if mode == ExpertFinalizationMode.NONE:
            return False
        configured = self.team.finalization.deliverable
        if configured and configured.required:
            return True
        request_text = self.request.input.strip().lower()
        if any(term.lower() in request_text for term in _DELIVERABLE_REQUEST_TERMS):
            return True
        task_text = "\n".join(
            part
            for task in self.team.tasks
            for part in (task.name, task.task or task.description, task.expected_output)
            if part
        ).lower()
        return any(term.lower() in task_text for term in ("交付", "产物", "文件", "视频", "网页", "pdf"))

    def _effective_deliverable_config(self) -> ExpertDeliverableConfig:
        deliverable = self.team.finalization.deliverable
        if deliverable is not None:
            return deliverable

        inferred_type = self._infer_deliverable_type_for_current_run()
        presentation = ExpertDeliverablePresentation.ARTIFACT_PANEL if inferred_type == ExpertDeliverableType.ARTIFACT else ExpertDeliverablePresentation.FILE_PREVIEW
        filename_template = self._default_deliverable_filename(inferred_type)
        return ExpertDeliverableConfig(
            required=True,
            type=inferred_type,
            title=self._default_deliverable_title(inferred_type),
            filename_template=filename_template,
            source="last_task",
            presentation=presentation,
            tools=self._default_deliverable_tools_for_type(inferred_type, presentation),
        )

    async def _run_deliverable_finalization(self, step: int) -> None:
        deliverable = self._effective_deliverable_config()
        before_count = len(self._deliverable_outputs)
        member = self._finalizer_member_for_deliverable(deliverable)
        attempts = _DELIVERABLE_FINALIZATION_MAX_ATTEMPTS if deliverable.required else 1
        last_text = ""
        for attempt in range(1, attempts + 1):
            if self.job.abort_event.is_set():
                return
            task = ExpertTaskConfig(
                id="final-deliverable" if attempt == 1 else f"final-deliverable-retry-{attempt}",
                name="产物交付" if attempt == 1 else f"产物交付重试 {attempt - 1}",
                member=member.id,
                task=self._build_deliverable_task_prompt(deliverable, attempt=attempt),
                expected_output=self._deliverable_expected_output(deliverable),
                max_tool_rounds=max(self.team.default_max_tool_rounds, 12),
                retry_count=1,
                context_policy=ExpertContextPolicy.EXPLICIT,
            )
            result = await self.task_runner.run_task(
                step + attempt - 1,
                task,
                member,
                system_override=self._build_deliverable_system_prompt(deliverable, attempt=attempt),
                messages_override=self._build_deliverable_messages(deliverable, attempt=attempt, last_text=last_text),
                snapshot_extra={
                    "finalization_mode": "deliverable",
                    "deliverable": self._deliverable_snapshot(deliverable),
                    "deliverable_attempt": attempt,
                    "deliverable_required": deliverable.required,
                },
                record_output=True,
            )
            last_text = result.text
            if self._has_new_deliverable_output(deliverable, before_count):
                return

            logger.warning(
                "Expert team %s deliverable attempt %d/%d finished without a real deliverable",
                self.team.id,
                attempt,
                attempts,
            )

        if deliverable.required:
            raise RuntimeError(
                "Final deliverable was required, but the expert team finished without presenting a file or artifact."
            )

    def _finalizer_member_for_deliverable(self, deliverable: ExpertDeliverableConfig) -> ExpertMemberConfig:
        base = self._finalizer_member()
        tools = self._deliverable_tools(deliverable, base)
        return base.model_copy(update={"tools": tools})

    def _deliverable_tools(self, deliverable: ExpertDeliverableConfig, member: ExpertMemberConfig) -> list[str]:
        configured = [
            *list(self.team.finalization.tools or []),
            *list(deliverable.tools or []),
        ]
        if not configured:
            configured = list(member.tools or [])

        required: list[str] = []
        deliverable_type = self._deliverable_type_value(deliverable)
        presentation = self._deliverable_presentation_value(deliverable)
        if deliverable_type == ExpertDeliverableType.ARTIFACT.value or presentation in {
            ExpertDeliverablePresentation.ARTIFACT_PANEL.value,
            ExpertDeliverablePresentation.BOTH.value,
        }:
            required.append("artifact")
        if deliverable_type in {
            ExpertDeliverableType.MARKDOWN.value,
            ExpertDeliverableType.HTML.value,
            ExpertDeliverableType.PDF.value,
            ExpertDeliverableType.DOCX.value,
            ExpertDeliverableType.XLSX.value,
            ExpertDeliverableType.PPTX.value,
            ExpertDeliverableType.CODE.value,
        } or presentation in {
            ExpertDeliverablePresentation.FILE_PREVIEW.value,
            ExpertDeliverablePresentation.BOTH.value,
        }:
            required.extend(["write", "present_file"])
        if deliverable_type in {
            ExpertDeliverableType.PDF.value,
            ExpertDeliverableType.DOCX.value,
            ExpertDeliverableType.XLSX.value,
            ExpertDeliverableType.PPTX.value,
        }:
            required.append("code_execute")

        result: list[str] = []
        for tool_id in [*configured, *required]:
            tool_name = str(tool_id).strip()
            if tool_name and tool_name not in result:
                result.append(tool_name)
        return result or ["write", "present_file"]

    def _default_deliverable_tools_for_type(
        self,
        deliverable_type: ExpertDeliverableType,
        presentation: ExpertDeliverablePresentation,
    ) -> list[str]:
        deliverable = ExpertDeliverableConfig(type=deliverable_type, presentation=presentation)
        return self._deliverable_tools(deliverable, ExpertMemberConfig(id=_COORDINATOR_ID, name="协调者", role="协调者", goal="交付产物"))

    def _infer_deliverable_type_for_current_run(self) -> ExpertDeliverableType:
        text = "\n".join(
            [
                self.request.input,
                self.team.name,
                self.team.description,
                " ".join(self.team.tags or []),
                " ".join(task.name for task in self.team.tasks),
                " ".join((task.task or task.description or "") for task in self.team.tasks),
                " ".join(task.expected_output for task in self.team.tasks),
            ]
        ).lower()
        rules: list[tuple[ExpertDeliverableType, tuple[str, ...]]] = [
            (ExpertDeliverableType.VIDEO, ("视频", "短片", "影片", "vimax", "video")),
            (ExpertDeliverableType.HTML, ("网页", "页面", "网站", "landing page", "html", "web page")),
            (ExpertDeliverableType.PDF, ("pdf", "白皮书", "可打印")),
            (ExpertDeliverableType.DOCX, ("word", "docx")),
            (ExpertDeliverableType.XLSX, ("excel", "xlsx", "表格", "数据表")),
            (ExpertDeliverableType.PPTX, ("ppt", "pptx", "幻灯片", "演示文稿")),
            (ExpertDeliverableType.IMAGE, ("图片", "海报", "插画", "封面", "image")),
            (ExpertDeliverableType.CODE, ("代码", "项目", "脚本", "组件", "源码")),
            (ExpertDeliverableType.ARTIFACT, ("artifact", "交互", "看板", "可视化")),
        ]
        for deliverable_type, keywords in rules:
            if any(keyword in text for keyword in keywords):
                return deliverable_type
        return ExpertDeliverableType.MARKDOWN

    def _default_deliverable_title(self, deliverable_type: ExpertDeliverableType) -> str:
        titles = {
            ExpertDeliverableType.VIDEO: "最终视频",
            ExpertDeliverableType.HTML: "最终网页",
            ExpertDeliverableType.PDF: "最终 PDF",
            ExpertDeliverableType.DOCX: "最终 Word 文档",
            ExpertDeliverableType.XLSX: "最终表格",
            ExpertDeliverableType.PPTX: "最终演示文稿",
            ExpertDeliverableType.IMAGE: "最终图片",
            ExpertDeliverableType.CODE: "最终代码产物",
            ExpertDeliverableType.ARTIFACT: "最终产物",
        }
        return titles.get(deliverable_type, "最终产物")

    def _default_deliverable_filename(self, deliverable_type: ExpertDeliverableType) -> str | None:
        ext_by_type = {
            ExpertDeliverableType.MARKDOWN: ".md",
            ExpertDeliverableType.HTML: ".html",
            ExpertDeliverableType.PDF: ".pdf",
            ExpertDeliverableType.DOCX: ".docx",
            ExpertDeliverableType.XLSX: ".xlsx",
            ExpertDeliverableType.PPTX: ".pptx",
            ExpertDeliverableType.CODE: ".md",
        }
        ext = ext_by_type.get(deliverable_type)
        if not ext:
            return None
        return f"final-deliverable{ext}"

    def _build_deliverable_system_prompt(self, deliverable: ExpertDeliverableConfig, *, attempt: int = 1) -> str:
        retry_instruction = ""
        if attempt > 1:
            retry_instruction = (
                f"This is deliverable enforcement attempt {attempt}. "
                "A previous finalization ended without a tracked file, artifact, image, or video. "
                "You must call a delivery tool in this attempt before writing final prose."
            )
        return "\n\n".join(
            [part for part in [
                self._build_coordinator_prompt(),
                "You are the expert team's final delivery specialist.",
                "Your job is to create or present a concrete user-facing deliverable, not only summarize prior work.",
                "You must call the appropriate tool before your final text: write+present_file for file deliverables, artifact for panel deliverables.",
                "A chat-only answer does not satisfy the deliverable contract.",
                "If a required deliverable cannot be produced, fail clearly and explain the blocking reason.",
                retry_instruction,
                f"Required deliverable contract: {json.dumps(self._deliverable_snapshot(deliverable), ensure_ascii=False)}",
            ] if part]
        )

    def _build_deliverable_messages(
        self,
        deliverable: ExpertDeliverableConfig,
        *,
        attempt: int = 1,
        last_text: str = "",
    ) -> list[dict[str, Any]]:
        source_text = self._deliverable_source_text(deliverable)
        context = self._build_deliverable_context(deliverable)
        instructions = self._build_deliverable_task_prompt(deliverable, attempt=attempt)
        sections = [
            "Expert team handoff context:\n" + context,
        ]
        if source_text and source_text.strip() != context.strip():
            sections.append("Preferred source material for final deliverable:\n" + source_text)
        if attempt > 1:
            sections.append(
                "Previous finalization text that did not satisfy delivery:\n"
                + (last_text.strip() or "<empty>")
            )
        sections.append(instructions)
        return [
            {
                "role": "user",
                "content": "\n\n---\n\n".join(sections),
            }
        ]

    def _build_deliverable_context(self, deliverable: ExpertDeliverableConfig) -> str:
        source = str(deliverable.source or "last_task").strip()
        sections = [f"Original user request:\n{self.request.input.strip()}"]
        if self.context.get("clarifications"):
            sections.append("User clarifications collected before execution:\n" + self.context["clarifications"])

        status_lines = []
        for task in self.team.tasks:
            status = self.task_statuses.get(task.id, {})
            if not status:
                continue
            line = f"- {task.id}: {status.get('status', 'unknown')}"
            if status.get("reason"):
                line += f" ({status['reason']})"
            status_lines.append(line)
        if status_lines:
            sections.append("Task status summary:\n" + "\n".join(status_lines))

        source_task_id = self._deliverable_source_task_id(source)
        coordinator_limit = max(1, self.team.coordinator_context_max_chars)
        known_task_ids = {task.id for task in self.team.tasks}
        for task in self.team.tasks:
            if task.id == source_task_id:
                continue
            member = self._member_for_task(task)
            output = self._coordinator_output_for_task(task, coordinator_limit)
            if not output:
                continue
            sections.append(
                "\n".join(
                    [
                        f"Expert: {member.name} ({member.role})",
                        f"Task: {task.name}",
                        "Handoff:",
                        output,
                    ]
                )
            )

        for task_id in self._completed_output_order:
            if task_id in known_task_ids or task_id == source_task_id:
                continue
            if task_id == "__manager__" and source in {"last_task", "__manager__"}:
                continue
            status = self.task_statuses.get(task_id, {})
            output = self._task_handoff_text(task_id, coordinator_limit)
            if not output:
                continue
            sections.append(
                "\n".join(
                    [
                        f"Expert: {status.get('member_name') or status.get('member_id') or task_id}",
                        f"Task: {status.get('task_name') or task_id}",
                        "Handoff:",
                        output,
                    ]
                )
            )
        return "\n\n---\n\n".join(sections)

    def _deliverable_source_task_id(self, source: str) -> str:
        if source == "last_task":
            task = self._last_completed_task()
            return task.id if task is not None else ""
        if source in self.task_outputs:
            return source
        for task in self.team.tasks:
            if task.output == source:
                return task.id
        return ""

    def _build_deliverable_task_prompt(self, deliverable: ExpertDeliverableConfig, *, attempt: int = 1) -> str:
        deliverable_type = self._deliverable_type_value(deliverable)
        presentation = self._deliverable_presentation_value(deliverable)
        filename = self._render_deliverable_filename(deliverable)
        lines = [
            "Create the final user-facing deliverable for this expert team run.",
            f"- Deliverable type: {deliverable_type}",
            f"- Title: {deliverable.title}",
            f"- Presentation: {presentation}",
            f"- Source: {deliverable.source}",
        ]
        if filename:
            lines.append(f"- Preferred filename: {filename}")
        if attempt > 1:
            lines.extend(
                [
                    f"- Enforcement attempt: {attempt}",
                    "- The previous attempt did not create or present a tracked deliverable.",
                ]
            )
        lines.extend(
            [
                "",
                "Hard requirements:",
                "- Do not finish with only prose in the chat.",
                "- If the deliverable is file-based, create the file and then call present_file with that file path.",
                "- If the deliverable is an artifact-panel deliverable, call artifact with command=create or rewrite and complete content.",
                "- Keep the final chat text brief and point to the created or presented deliverable.",
            ]
        )
        return "\n".join(lines)

    def _deliverable_expected_output(self, deliverable: ExpertDeliverableConfig) -> str:
        deliverable_type = self._deliverable_type_value(deliverable)
        if deliverable_type == ExpertDeliverableType.VIDEO.value:
            return "最终视频文件已生成或已通过 present_file 展示，并附简短状态说明。"
        if deliverable_type == ExpertDeliverableType.ARTIFACT.value:
            return "最终 artifact 已在产物面板创建，并附简短说明。"
        return "最终文件已写入工作区并通过 present_file 展示，附简短说明。"

    def _deliverable_source_text(self, deliverable: ExpertDeliverableConfig) -> str:
        source = str(deliverable.source or "last_task").strip()
        if source == "last_task":
            task = self._last_completed_task()
            return self.task_outputs.get(task.id, "") if task else ""
        if source == "coordinator":
            return self._build_coordinator_messages()[0]["content"]
        if source in self.task_outputs:
            return self.task_outputs[source]
        if source in self.context:
            return self.context[source]
        for task in self.team.tasks:
            if task.output == source:
                return self.context.get(task.id, "") or self.task_outputs.get(task.id, "")
        return ""

    def _render_deliverable_filename(self, deliverable: ExpertDeliverableConfig) -> str:
        template = deliverable.filename_template
        if not template:
            return ""
        try:
            rendered = render_template(template, self.context, strict=False)
        except Exception:
            rendered = template
        return rendered.strip()

    def _deliverable_snapshot(self, deliverable: ExpertDeliverableConfig) -> dict[str, Any]:
        return {
            "required": deliverable.required,
            "type": self._deliverable_type_value(deliverable),
            "title": deliverable.title,
            "filename_template": deliverable.filename_template,
            "source": deliverable.source,
            "presentation": self._deliverable_presentation_value(deliverable),
            "tools": list(deliverable.tools or []),
        }

    def _has_new_deliverable_output(self, deliverable: ExpertDeliverableConfig, before_count: int) -> bool:
        outputs = self._deliverable_outputs[before_count:]
        if not outputs:
            return False
        deliverable_type = self._deliverable_type_value(deliverable)
        presentation = self._deliverable_presentation_value(deliverable)
        for output in outputs:
            if self._deliverable_output_matches_contract(output, deliverable_type, presentation):
                return True
        return False

    def _deliverable_output_matches_contract(
        self,
        output: dict[str, Any],
        deliverable_type: str,
        presentation: str,
    ) -> bool:
        kind = str(output.get("kind") or "").strip().lower()
        path = str(output.get("path") or "").strip()
        suffix = Path(path).suffix.lower() if path else ""

        if deliverable_type == ExpertDeliverableType.ARTIFACT.value:
            return kind == "artifact"
        if presentation == ExpertDeliverablePresentation.ARTIFACT_PANEL.value:
            return kind == "artifact"
        if presentation == ExpertDeliverablePresentation.BOTH.value and kind == "artifact":
            return True
        if deliverable_type == ExpertDeliverableType.VIDEO.value:
            return kind == "video" or suffix in {".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"}
        if deliverable_type == ExpertDeliverableType.IMAGE.value:
            return kind == "image" or suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
        expected_suffixes = {
            ExpertDeliverableType.MARKDOWN.value: {".md", ".markdown"},
            ExpertDeliverableType.HTML.value: {".html", ".htm"},
            ExpertDeliverableType.PDF.value: {".pdf"},
            ExpertDeliverableType.DOCX.value: {".docx"},
            ExpertDeliverableType.XLSX.value: {".xlsx"},
            ExpertDeliverableType.PPTX.value: {".pptx"},
            ExpertDeliverableType.CODE.value: {".zip", ".tar", ".gz", ".py", ".ts", ".tsx", ".js", ".jsx", ".md"},
        }
        suffixes = expected_suffixes.get(deliverable_type)
        if suffixes:
            return kind == "file" and (not suffix or suffix in suffixes)
        return kind in {"file", "artifact", "image", "video"}

    def _deliverable_type_value(self, deliverable: ExpertDeliverableConfig) -> str:
        value = deliverable.type
        if isinstance(value, ExpertDeliverableType):
            return value.value
        return str(value or ExpertDeliverableType.MARKDOWN.value)

    def _deliverable_presentation_value(self, deliverable: ExpertDeliverableConfig) -> str:
        value = deliverable.presentation
        if isinstance(value, ExpertDeliverablePresentation):
            return value.value
        return str(value or ExpertDeliverablePresentation.BOTH.value)

    def _finalizer_member(self) -> ExpertMemberConfig:
        member_id = self.team.finalization.member
        if member_id:
            for member in self.team.members:
                if member.id == member_id:
                    return member
        return ExpertMemberConfig(
            id=_COORDINATOR_ID,
            name="协调者",
            role="专家团协调者",
            goal=self.team.coordinator_prompt,
            tools=list(self.team.finalization.tools),
        )

    def _last_completed_task(self) -> ExpertTaskConfig | None:
        if self.team.process == ExpertTeamProcess.HIERARCHICAL and self.task_outputs.get("__manager__"):
            member = self._hierarchical_manager_member_for_finalization()
            return ExpertTaskConfig(
                id="__manager__",
                name="经理调度与最终交付",
                member=member.id,
                task="Hierarchical manager final answer.",
                expected_output="Final answer synthesized by the manager.",
            )
        for task_id in reversed(self._completed_output_order):
            status = self.task_statuses.get(task_id, {}).get("status")
            if status not in {"completed", "truncated"}:
                continue
            text = self.task_outputs.get(task_id)
            if not text:
                continue
            task = self._task_for_output(task_id)
            if task is not None:
                return task
        return None

    def _hierarchical_manager_member_for_finalization(self) -> ExpertMemberConfig:
        manager_member_id = self.task_statuses.get("__manager__", {}).get("member_id")
        if isinstance(manager_member_id, str):
            for member in self.team.members:
                if member.id == manager_member_id:
                    return member
        if self.team.manager and self.team.manager.member:
            for member in self.team.members:
                if member.id == self.team.manager.member:
                    return member
        return ExpertMemberConfig(
            id="__manager__",
            name="专家团经理",
            role="专家团经理",
            goal=self.team.manager.prompt if self.team.manager else self.team.coordinator_prompt,
            model=self.request.model,
            provider_id=self.request.provider_id,
        )

    def _hierarchical_member_for_task(self, task: ExpertTaskConfig) -> ExpertMemberConfig:
        status = self.task_statuses.get(task.id, {})
        member_id = str(status.get("member_id") or task.member).strip()
        for member in self.team.members:
            if member.id == member_id:
                return member
        return ExpertMemberConfig(
            id=member_id or "__manager__",
            name=str(status.get("member_name") or "专家团经理"),
            role=str(status.get("member_role") or "专家团经理"),
            goal=self.team.manager.prompt if self.team.manager else self.team.coordinator_prompt,
            model=self.request.model,
            provider_id=self.request.provider_id,
        )

    def _task_for_output(self, task_id: str) -> ExpertTaskConfig | None:
        task = next((item for item in self.team.tasks if item.id == task_id), None)
        if task is not None:
            return task
        status = self.task_statuses.get(task_id)
        if not isinstance(status, dict):
            return None
        member_id = str(status.get("member_id") or "").strip()
        if not member_id:
            return None
        task_name = str(status.get("task_name") or task_id).strip() or task_id
        task_description = str(status.get("task_description") or task_name).strip() or task_name
        try:
            return ExpertTaskConfig(
                id=task_id,
                name=task_name,
                description=task_description,
                task=task_description,
                expected_output=str(status.get("expected_output") or ""),
                member=member_id,
                output=str(status.get("task_output") or "").strip() or None,
            )
        except Exception:
            return None

    def _mark_completed_output(self, task_id: str) -> None:
        if task_id in self._completed_output_order:
            self._completed_output_order.remove(task_id)
        self._completed_output_order.append(task_id)

    def _restore_unknown_task_output(
        self,
        task_id: str,
        text: str,
        *,
        status: str,
        reason: str,
        snapshot: dict[str, Any],
        structured: dict[str, Any] | None,
    ) -> None:
        self.task_outputs[task_id] = text
        self.context[task_id] = json.dumps(structured, ensure_ascii=False, separators=(",", ":")) if structured is not None else text
        restored_handoff = str(snapshot.get("handoff") or "").strip()
        if not restored_handoff:
            restored_handoff = self._compact_text(self.context[task_id], max(500, min(self.team.coordinator_context_max_chars, 4000)))
        self.task_handoffs[task_id] = restored_handoff
        self.task_summaries[task_id] = restored_handoff
        self.task_statuses[task_id] = {
            "status": status,
            "reason": reason,
            "member_id": str(snapshot.get("member_id") or ""),
            "member_name": str(snapshot.get("member_name") or ""),
            "member_role": str(snapshot.get("member_role") or ""),
            "task_name": str(snapshot.get("task_name") or task_id),
            "task_description": str(snapshot.get("task_description") or snapshot.get("task_name") or task_id),
            "task_output": str(snapshot.get("task_output") or ""),
            "hierarchical": bool(snapshot.get("hierarchical")),
            "delegated_by": str(snapshot.get("delegated_by") or ""),
            "delegation_index": snapshot.get("delegation_index"),
            "handoff": restored_handoff,
            "restored": True,
            "restored_partial": True,
            **({"structured": structured} if structured is not None else {}),
            **({"truncated": True} if status == "truncated" else {}),
        }
        self._mark_completed_output(task_id)

    async def _stream_once(
        self,
        *,
        member: ExpertMemberConfig,
        message_id: str,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        response_format: dict[str, Any] | None = None,
    ) -> tuple[str, list[dict[str, Any]], str]:
        text = ""
        tool_calls: list[dict[str, Any]] = []
        finish_reason = "stop"
        model = member.model or self.request.model
        provider_id = member.provider_id or self.request.provider_id
        extra_body = {"reasoning": {"enabled": False}} if self.request.reasoning is False else None

        async for chunk in self.llm.stream(
            model=model,
            provider_id=provider_id,
            messages=messages,
            system=system,
            tools=tools,
            temperature=member.temperature,
            max_tokens=member.max_tokens,
            extra_body=extra_body,
            response_format=response_format,
        ):
            if self.job.abort_event.is_set():
                break
            if chunk.type == "text-delta":
                delta = str(chunk.data.get("text") or "")
                text += delta
            elif chunk.type == "tool-call":
                tool_calls.append(dict(chunk.data))
            elif chunk.type == "usage":
                self._accumulate_usage(chunk.data)
            elif chunk.type == "finish":
                finish_reason = str(chunk.data.get("reason") or "stop")
            elif chunk.type == "error":
                raise RuntimeError(str(chunk.data.get("message") or "LLM stream error"))

        return text, tool_calls, finish_reason

    async def _stream_once_with_retry(
        self,
        *,
        task: ExpertTaskConfig,
        member: ExpertMemberConfig,
        message_id: str,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        response_format: dict[str, Any] | None = None,
    ) -> tuple[str, list[dict[str, Any]], str]:
        attempts = max(0, task.retry_count) + 1
        timeout = max(1, task.timeout_seconds)
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                return await asyncio.wait_for(
                    self._stream_once(
                        member=member,
                        message_id=message_id,
                        system=system,
                        messages=messages,
                        tools=tools,
                        response_format=response_format,
                    ),
                    timeout=timeout,
                )
            except asyncio.TimeoutError as exc:
                last_error = TimeoutError(f"Task '{task.id}' timed out after {timeout}s")
            except Exception as exc:
                last_error = exc

            if self.job.abort_event.is_set() or attempt >= attempts - 1:
                break
            delay = self._retry_delay(attempt, last_error)
            logger.warning(
                "Expert task %s failed on attempt %d/%d: %s; retrying in %.1fs",
                task.id,
                attempt + 1,
                attempts,
                last_error,
                delay,
            )
            await asyncio.sleep(delay)

        raise RuntimeError(str(last_error or f"Task '{task.id}' failed"))

    async def _execute_tool(
        self,
        *,
        message_id: str,
        member: ExpertMemberConfig,
        agent: Any,
        ruleset: Any,
        discovered_tools: set[str],
        tool_call: dict[str, Any],
        messages: list[dict[str, Any]],
        synthetic_tool_executor: Any | None = None,
    ) -> str:
        name = str(tool_call.get("name") or "")
        args = tool_call.get("arguments", {})
        if not isinstance(args, dict):
            args = {}
        call_id = str(tool_call.get("id") or generate_ulid())

        if synthetic_tool_executor is not None:
            synthetic_output = await synthetic_tool_executor(name, args, call_id, message_id, messages)
            if synthetic_output is not None:
                return str(synthetic_output)

        tool = self.tool_registry.get(name) or self.tool_registry.get(name.lower())
        if tool is None:
            return f"Tool not found: {name}"
        if tool.id == "question":
            return (
                "The question tool is disabled for individual expert tasks. "
                "User clarification is handled by the expert team coordinator during preflight."
            )

        resource_pattern = args.get("file_path", "*") if tool.id in _FILE_TOOLS else "*"
        action = evaluate(tool.id, str(resource_pattern), ruleset)
        if action == "deny":
            return f"Permission denied for tool: {tool.id}"

        if action == "ask" and self.job.interactive:
            allowed = await self._ask_permission(tool.id, call_id, args, str(resource_pattern))
            if not allowed:
                return f"User denied permission for: {tool.id}"

        part_id = generate_ulid()
        async with self.session_factory() as db:
            async with db.begin():
                await create_part(
                    db,
                    message_id=message_id,
                    session_id=self.job.session_id,
                    part_id=part_id,
                    data={
                        "type": "tool",
                        "tool": tool.id,
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
        self.stream.tool_start(tool.id, call_id, args)

        ctx = ToolContext(
            session_id=self.job.session_id,
            message_id=message_id,
            agent=agent,
            call_id=call_id,
            abort_event=self.job.abort_event,
            workspace=self.request.workspace or ".",
            allowed_file_paths=set(self._allowed_file_paths),
            index_manager=self.index_manager,
            messages=messages,
            discovered_tools=discovered_tools,
            _publish_fn=lambda event, data: self.job.publish(SSEEvent(event, data)),
        )
        ctx._app_state = {  # type: ignore[attr-defined]
            "session_factory": self.session_factory,
            "provider_registry": self.provider_registry,
            "tool_registry": self.tool_registry,
            "expert_team_registry": None,
            "expert_role_registry": self.role_registry,
            "skill_registry": self.skill_registry,
            "settings": self._runtime_settings(),
        }
        ctx._model_id = member.model or self.request.model  # type: ignore[attr-defined]
        ctx._provider_id = member.provider_id or self.request.provider_id  # type: ignore[attr-defined]
        ctx._job = self.job  # type: ignore[attr-defined]
        ctx._depth = self.job._depth  # type: ignore[attr-defined]

        result = await tool(args, ctx)
        output = result.output or result.error or ""
        status = "completed" if result.success else "error"
        metadata = dict(result.metadata or {})
        title = result.title

        async with self.session_factory() as db:
            async with db.begin():
                await update_part_data(
                    db,
                    part_id,
                    {
                        "type": "tool",
                        "tool": tool.id,
                        "call_id": call_id,
                        "state": {
                            "status": status,
                            "input": args,
                            "output": output,
                            "metadata": metadata,
                            "title": title,
                            "time_start": None,
                            "time_end": None,
                            "time_compacted": None,
                        },
                    },
                )
                for attachment in result.attachments:
                    await create_part(
                        db,
                        message_id=message_id,
                        session_id=self.job.session_id,
                        data={"type": "file", **attachment},
                    )
                    path = str(attachment.get("path") or "")
                    if path:
                        await self._track_session_file(db, path, tool.id)
                metadata_file_path = metadata.get("file_path")
                if result.success and isinstance(metadata_file_path, str) and metadata_file_path.strip() and tool.id in _DELIVERABLE_FILE_TOOLS:
                    await self._track_session_file(db, metadata_file_path, tool.id)
        self.stream.tool_result(tool.id, call_id, output, title=title, metadata=metadata)
        if result.success:
            self._record_deliverable_output(tool.id, output, metadata, title=title, args=args)
        if result.error and metadata.get("blocking_error"):
            raise RuntimeError(output)
        return output

    def _record_deliverable_output(
        self,
        tool_id: str,
        output: str,
        metadata: dict[str, Any],
        *,
        title: str | None = None,
        args: dict[str, Any] | None = None,
    ) -> None:
        if tool_id == "artifact":
            command = str(metadata.get("command") or (args or {}).get("command") or "").strip().lower()
            if command in {"create", "update", "rewrite"} and (metadata.get("content") or output):
                self._deliverable_outputs.append(
                    {
                        "kind": "artifact",
                        "title": str(metadata.get("title") or title or "artifact"),
                        "identifier": str(metadata.get("identifier") or (args or {}).get("identifier") or ""),
                    }
                )
            return

        if tool_id == "present_file":
            file_path = metadata.get("file_path") or (args or {}).get("file_path")
            if isinstance(file_path, str) and file_path.strip():
                self._deliverable_outputs.append(
                    {
                        "kind": "file",
                        "path": file_path,
                        "title": str(metadata.get("title") or title or ""),
                        "tool": tool_id,
                    }
                )
            return

        if tool_id in {"write", "edit"}:
            return

    async def _track_session_file(self, db: AsyncSession, file_path: str, tool_id: str) -> None:
        path = Path(file_path)
        result = await db.execute(
            select(SessionFile.id)
            .where(SessionFile.session_id == self.job.session_id)
            .where(SessionFile.file_path == file_path)
            .limit(1)
        )
        if result.scalar_one_or_none() is not None:
            return
        db.add(
            SessionFile(
                id=generate_ulid(),
                session_id=self.job.session_id,
                file_path=file_path,
                file_name=path.name,
                tool_id=tool_id,
                file_type="generated",
            )
        )

    async def _ask_permission(self, tool_name: str, call_id: str, args: dict[str, Any], pattern: str) -> bool:
        permission_call_id = generate_ulid()
        self.job.publish(
            SSEEvent(
                "permission-request",
                {
                    "call_id": permission_call_id,
                    "tool_call_id": call_id,
                    "tool": tool_name,
                    "permission": tool_name,
                    "patterns": [pattern],
                    "arguments": args,
                    "message": f"Allow expert team to use {tool_name}?",
                    "arguments_truncated": False,
                },
            )
        )
        try:
            response = await self.job.wait_for_response(permission_call_id, timeout=300.0)
        except TimeoutError:
            return False
        if isinstance(response, dict):
            return bool(response.get("allowed"))
        return str(response).lower() in {"allow", "yes", "true", "1"}

    async def _create_assistant_message(self, member: ExpertMemberConfig) -> str:
        async with self.session_factory() as db:
            async with db.begin():
                msg = await create_message(
                    db,
                    session_id=self.job.session_id,
                    data={
                        "role": "assistant",
                        "agent": member.name,
                        "mode": "expert-team",
                        "expert_team": self.team.id,
                        "expert_member": member.id,
                        "model_id": member.model or self.request.model,
                        "provider_id": member.provider_id or self.request.provider_id,
                    },
                )
                return msg.id

    async def _create_coordinator_message(self) -> str:
        async with self.session_factory() as db:
            async with db.begin():
                msg = await create_message(
                    db,
                    session_id=self.job.session_id,
                    data={
                        "role": "assistant",
                        "agent": "协调者",
                        "mode": "expert-team",
                        "expert_team": self.team.id,
                        "expert_member": _COORDINATOR_ID,
                        "model_id": self.request.model,
                        "provider_id": self.request.provider_id,
                    },
                )
                return msg.id

    async def _persist_text(self, message_id: str, text: str) -> None:
        if self.session_factory is None:
            return
        async with self.session_factory() as db:
            async with db.begin():
                await create_part(
                    db,
                    message_id=message_id,
                    session_id=self.job.session_id,
                    data={"type": "text", "text": text},
                )

    async def _persist_raw_and_visible_text(
        self,
        message_id: str,
        raw_text: str,
        visible_text: str,
    ) -> None:
        if self.session_factory is None:
            return
        raw_text = raw_text.strip()
        visible_text = visible_text.strip()
        async with self.session_factory() as db:
            async with db.begin():
                if raw_text and raw_text != visible_text:
                    await create_part(
                        db,
                        message_id=message_id,
                        session_id=self.job.session_id,
                        data={
                            "type": _RAW_OUTPUT_PART_TYPE,
                            "text": raw_text,
                            "hidden": True,
                        },
                    )
                if visible_text:
                    await create_part(
                        db,
                        message_id=message_id,
                        session_id=self.job.session_id,
                        data={"type": "text", "text": visible_text},
                    )

    def _uses_concise_expert_output(self) -> bool:
        style = self.team.expert_output_style
        if not isinstance(style, ExpertOutputStyle):
            try:
                style = ExpertOutputStyle(str(style))
            except ValueError:
                style = ExpertOutputStyle.CONCISE
        return style == ExpertOutputStyle.CONCISE

    def _visible_task_output(
        self,
        task: ExpertTaskConfig,
        text: str,
        *,
        member: ExpertMemberConfig,
        structured: dict[str, Any] | None,
        finalization_mode: bool = False,
    ) -> str:
        cleaned = text.strip()
        if not cleaned:
            return ""
        if structured is not None:
            return self._compact_expert_visible_text(cleaned, self.team.expert_visible_max_chars)
        if not self._uses_concise_expert_output():
            return cleaned

        limit = (
            self.team.coordinator_visible_max_chars
            if member.id == _COORDINATOR_ID or finalization_mode or task.id.startswith("final")
            else self.team.expert_visible_max_chars
        )
        return self._compact_expert_visible_text(cleaned, max(1, limit))

    def _compact_expert_visible_text(self, text: str, limit: int) -> str:
        limit = max(1, limit)
        cleaned = text.strip()
        if len(cleaned) <= limit:
            return cleaned

        extracted = self._extract_handoff_sections(cleaned)
        if extracted and len(extracted) <= limit:
            return extracted
        if extracted:
            return self._trim_visible_text(self._compact_text(extracted, limit), limit)

        return self._trim_visible_text(self._compact_text(cleaned, limit), limit)

    def _trim_visible_text(self, text: str, limit: int) -> str:
        cleaned = text.strip()
        if len(cleaned) <= limit:
            return cleaned
        marker = "\n\n[Visible expert output truncated]"
        if limit <= len(marker) + 20:
            return cleaned[:limit].rstrip()
        available = limit - len(marker)
        head_len = max(1, int(available * 0.7))
        tail_len = max(0, available - head_len)
        tail = cleaned[-tail_len:].lstrip() if tail_len else ""
        trimmed = f"{cleaned[:head_len].rstrip()}{marker}{tail}"
        return trimmed[:limit].rstrip()

    async def _persist_step_start(self, message_id: str, snapshot: dict[str, Any]) -> None:
        async with self.session_factory() as db:
            async with db.begin():
                await create_part(
                    db,
                    message_id=message_id,
                    session_id=self.job.session_id,
                    data={"type": "step-start", "snapshot": snapshot},
                )

    async def _persist_step_finish(
        self,
        message_id: str,
        reason: str,
        snapshot: dict[str, Any] | None = None,
        publish: bool = True,
    ) -> None:
        cost = (snapshot or {}).get("cost", 0.0)
        async with self.session_factory() as db:
            async with db.begin():
                await create_part(
                    db,
                    message_id=message_id,
                    session_id=self.job.session_id,
                    data={
                        "type": "step-finish",
                        "reason": reason,
                        "tokens": (snapshot or {}).get("tokens", {}),
                        "cost": cost,
                        "snapshot": snapshot or {},
                    },
                )
        if publish:
            self.stream.step_finish(
                reason="tool_use",
                tokens=(snapshot or {}).get("tokens", {}) if snapshot else {},
                cost=cost,
                message_id=message_id,
                snapshot=snapshot or {},
            )

    def _is_data_analysis_team(self) -> bool:
        """Heuristic: a data-analysis team by category or tag."""
        category = (self.team.category or "").strip()
        tags = {str(t).strip().lower() for t in (self.team.tags or [])}
        return category == "数据分析" or "数据分析" in tags or "data-analysis" in tags

    async def _load_analysis_memory(self) -> None:
        """Prefetch the user's analysis-memory section (data teams only)."""
        if not self._is_data_analysis_team():
            return
        try:
            from app.memory.analysis_memory_injection import build_analysis_memory_section

            # Single-user open-source build: user_id None.
            self._analysis_memory_section = await build_analysis_memory_section(
                self.session_factory, None
            )
        except Exception:
            logger.debug("Expert analysis-memory injection skipped", exc_info=True)

    def _build_system_prompt(self, member: ExpertMemberConfig) -> str:
        skills = sorted(set([*self.team.skills, *member.skills]))
        connectors = sorted(set([*self.team.connectors, *member.connectors]))
        workspace = self.request.workspace or "."
        lines = []
        role_prompt = member.system_prompt or self._role_prompt(member)
        if role_prompt:
            lines.append(role_prompt)
            lines.append("---")
        lines.extend([
            f"You are {member.name}, acting as {member.role}.",
            member.goal,
            f"Workspace directory: {workspace}",
        ])
        if member.backstory:
            lines.append(member.backstory)
        if skills:
            lines.append("Use these Codata skills when relevant: " + ", ".join(skills))
        if connectors:
            lines.append("The team may rely on these MCP connectors: " + ", ".join(connectors))
        if self._analysis_memory_section:
            lines.append(self._analysis_memory_section)
        lines.append("Work as one member of an expert team. Be concise, concrete, and hand off useful context to the next expert.")
        lines.append("Do not ask the user questions directly. Any user clarification is collected by the team coordinator before execution. If information is still missing, state the assumption you used.")
        if self._uses_concise_expert_output():
            lines.append(
                "\n".join(
                    [
                        "Output style:",
                        "- Keep the visible answer concise and decision-oriented, like a normal Codata answer.",
                        "- Lead with the conclusion or completed action.",
                        "- Include only key evidence, assumptions, risks, and next handoff.",
                        "- Do not write a long report unless the task explicitly asks for one or you are creating a deliverable.",
                        "- End with a short section named `交接摘要` containing only what the next expert or coordinator must know.",
                    ]
                )
            )
        return "\n\n".join(lines)

    def _messages_with_auto_loaded_skills(
        self,
        messages: list[dict[str, Any]],
        member: ExpertMemberConfig,
    ) -> list[dict[str, Any]]:
        skills = sorted(set([*self.team.skills, *member.skills]))
        if not skills:
            return messages
        loaded = self._loaded_skill_context(skills)
        if not loaded:
            return messages
        return [
            {
                "role": "user",
                "content": (
                    "The following Codata skills are preloaded for this expert task. "
                    "Follow them when relevant, and treat bundled resource paths as relative to each skill base directory.\n\n"
                    + loaded
                    + "\n\n---\n\nContinue with the assigned expert task below."
                ),
            },
            *messages,
        ]

    def _loaded_skill_context(self, skill_names: list[str]) -> str:
        if self.skill_registry is None:
            return "Configured skills could not be loaded because the skill registry is not available."
        sections: list[str] = []
        for name in skill_names:
            try:
                skill = self.skill_registry.get(name)
                disabled = self.skill_registry.is_disabled(name)
            except Exception:
                skill = None
                disabled = True
            if skill is None or disabled:
                sections.append(f'<skill_unavailable name="{name}">Skill not found or disabled.</skill_unavailable>')
                continue
            skill_dir = Path(skill.location).parent
            sections.append(
                "\n".join(
                    [
                        f'<skill_content name="{skill.name}">',
                        f"# Skill: {skill.name}",
                        "",
                        skill.content.strip(),
                        "",
                        f"Base directory for this skill: {skill_dir}",
                        "</skill_content>",
                    ]
                )
            )
        return "\n\n".join(sections)

    def _role_prompt(self, member: ExpertMemberConfig) -> str | None:
        if not member.role_ref or self.role_registry is None:
            return None
        try:
            role = self.role_registry.get(member.role_ref)
        except Exception:
            return None
        if role is None:
            return None
        return str(getattr(role, "system_prompt", "") or "") or None

    def _build_coordinator_prompt(self) -> str:
        parts = [
            self.team.coordinator_prompt,
            "Do not pretend to be a single standalone assistant. Make it clear that the answer integrates the expert team's work.",
            "Use any user clarifications collected during preflight as higher-priority context than assumptions made by individual experts.",
            "Use the user's language.",
        ]
        if self._uses_concise_expert_output():
            parts.append(
                "\n".join(
                    [
                        "Final answer style:",
                        "- Lead with the direct answer or final status.",
                        "- Summarize the integrated expert-team result instead of replaying each expert's full output.",
                        "- Keep the chat response brief unless the user explicitly requested a full report in chat.",
                        "- Put detailed deliverables in files, artifacts, or referenced outputs when available.",
                    ]
                )
            )
        return "\n\n".join(parts)

    def _build_messages(self, task: ExpertTaskConfig) -> list[dict[str, Any]]:
        task_text = task.task or task.description
        description = render_template(task_text.replace("{input}", "{{user_input}}"), self.context, strict=False)
        content = description
        if task.expected_output:
            content += f"\n\nExpected output:\n{task.expected_output}"
        if self.context.get("clarifications"):
            content += f"\n\nUser clarifications collected before the expert team started:\n{self.context['clarifications']}"
        context_blocks = self._context_blocks_for_task(task, description)
        if context_blocks:
            content += "\n\nPrevious expert outputs:\n" + "\n\n".join(context_blocks)

        file_parts = self._file_parts_for_attachments()
        if not file_parts:
            return [{"role": "user", "content": content}]

        content += (
            "\n\nAttached file list:\n"
            + "\n".join(self._format_attachment_for_context(part) for part in file_parts)
        )
        content += (
            "\n\nAttached files are part of the user's request. "
            "Use their inline content below, or call the read tool with the exact file path for full content."
        )
        content_array = build_user_content_with_files(content, file_parts)
        if content_array:
            return [{"role": "user", "content": content_array}]
        return [{"role": "user", "content": content}]

    def _build_coordinator_messages(self) -> list[dict[str, Any]]:
        sections = [f"Original user request:\n{self.request.input.strip()}"]
        file_parts = self._file_parts_for_attachments()
        if file_parts:
            sections.append(
                "Attached files:\n"
                + "\n".join(self._format_attachment_for_context(part) for part in file_parts)
            )
        if self.context.get("clarifications"):
            sections.append("User clarifications collected before execution:\n" + self.context["clarifications"])
        status_lines = []
        for task in self.team.tasks:
            status = self.task_statuses.get(task.id, {})
            if not status:
                continue
            line = f"- {task.id}: {status.get('status', 'unknown')}"
            if status.get("reason"):
                line += f" ({status['reason']})"
            status_lines.append(line)
        if status_lines:
            sections.append("Task status summary:\n" + "\n".join(status_lines))

        if self.team.process == ExpertTeamProcess.HIERARCHICAL and self.task_outputs.get("__manager__"):
            manager_status = self.task_statuses.get("__manager__", {})
            manager_line = f"Manager status: {manager_status.get('status', 'completed')}"
            if manager_status.get("reason"):
                manager_line += f" ({manager_status['reason']})"
            sections.append(
                "\n".join(
                    [
                        manager_line,
                        "Hierarchical manager final output:",
                        self._compact_text(
                            self.task_outputs["__manager__"],
                            max(1, self.team.coordinator_context_max_chars),
                        ),
                    ]
                )
            )

        coordinator_limit = max(1, self.team.coordinator_context_max_chars)
        for task in self.team.tasks:
            member = self._member_for_task(task)
            output = self._coordinator_output_for_task(task, coordinator_limit)
            if not output:
                continue
            sections.append(
                "\n".join(
                    [
                        f"Expert: {member.name} ({member.role})",
                        f"Task: {task.name}",
                        "Output:",
                        output,
                    ]
                )
            )
        known_task_ids = {task.id for task in self.team.tasks}
        for task_id in self._completed_output_order:
            if task_id in known_task_ids or task_id == "__manager__":
                continue
            status = self.task_statuses.get(task_id, {})
            output = self.task_outputs.get(task_id, "")
            if not output:
                continue
            sections.append(
                "\n".join(
                    [
                        f"Expert: {status.get('member_name') or status.get('member_id') or task_id}",
                        f"Task: {status.get('task_name') or task_id}",
                        "Output:",
                        self._compact_text(output, coordinator_limit),
                    ]
                )
            )
        return [
            {
                "role": "user",
                "content": "\n\n---\n\n".join(sections),
            }
        ]

    def _context_blocks_for_task(self, task: ExpertTaskConfig, rendered_description: str) -> list[str]:
        policy = task.context_policy
        if not isinstance(policy, ExpertContextPolicy):
            try:
                policy = ExpertContextPolicy(str(policy))
            except ValueError:
                policy = ExpertContextPolicy.AUTO
        if policy == ExpertContextPolicy.AUTO:
            policy = ExpertContextPolicy.EXPLICIT if self._description_uses_dependency_output(task, rendered_description) else ExpertContextPolicy.SUMMARY
        if policy == ExpertContextPolicy.EXPLICIT:
            return []

        blocks: list[str] = []
        limit = max(1, task.context_max_chars)
        for task_id in task.depends_on or task.context:
            output = self.task_outputs.get(task_id)
            if not output:
                continue
            if policy == ExpertContextPolicy.SUMMARY:
                output = self._task_handoff_text(task_id, limit)
            else:
                output = self._compact_text(output, limit)
            blocks.append(f"[{task_id}]\n{output}")
        return blocks

    def _description_uses_dependency_output(self, task: ExpertTaskConfig, rendered_description: str) -> bool:
        raw = task.task or task.description or ""
        for dep_id in task.depends_on or task.context:
            dep_task = next((item for item in self.team.tasks if item.id == dep_id), None)
            if dep_task and dep_task.output and f"{{{{{dep_task.output}}}}}" in raw:
                return True
            output = self.task_outputs.get(dep_id)
            if output and output[:500] in rendered_description:
                return True
        return False

    def _coordinator_output_for_task(self, task: ExpertTaskConfig, limit: int) -> str:
        output = self.task_outputs.get(task.id, "")
        if not output:
            return ""
        policy = self.team.coordinator_context_policy
        if not isinstance(policy, ExpertContextPolicy):
            try:
                policy = ExpertContextPolicy(str(policy))
            except ValueError:
                policy = ExpertContextPolicy.SUMMARY
        if policy == ExpertContextPolicy.EXPLICIT:
            return ""
        if policy == ExpertContextPolicy.SUMMARY:
            return self._task_handoff_text(task.id, limit)
        return self._compact_text(output, limit)

    def _summary_limit_for_task(self, task: ExpertTaskConfig) -> int:
        return max(500, min(task.context_max_chars, 4000))

    def _compact_text(self, text: str, limit: int) -> str:
        cleaned = text.strip()
        if len(cleaned) <= limit:
            return cleaned
        head_len = max(0, int(limit * 0.7))
        tail_len = max(0, limit - head_len)
        head = cleaned[:head_len].rstrip()
        tail = cleaned[-tail_len:].lstrip() if tail_len else ""
        return (
            f"{head}\n\n"
            f"[Expert output truncated for context: original {len(cleaned)} chars, kept {limit}]\n\n"
            f"{tail}"
        )

    def _step_snapshot(
        self,
        *,
        step: int,
        title: str,
        member: ExpertMemberConfig,
        task: ExpertTaskConfig,
        status: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        snapshot = {
            "step": step,
            "title": title,
            "mode": "expert-team",
            "process": self.team.process,
            "expert_team": self.team.id,
            "member_id": member.id,
            "member_name": member.name,
            "member_role": member.role,
            "member_icon": member.icon,
            "task_id": task.id,
            "task_name": task.name,
            "task_description": task.description,
            "task_output": task.output,
            "depends_on": task.depends_on or task.context,
            "skills": self._capability_lists(member)[0],
            "tools": self._capability_lists(member)[1],
            "status": status,
        }
        if reason:
            snapshot["reason"] = reason
        return snapshot

    def _capability_lists(self, member: ExpertMemberConfig | None) -> tuple[list[str], list[str]]:
        if member is None:
            return [], []
        skills = sorted({*(self.team.skills or []), *(member.skills or [])})
        tools = sorted({*(member.tools or [])})
        return skills, tools

    def _result_preview(self, text: str, limit: int = 2000) -> str:
        cleaned = text.strip()
        if len(cleaned) <= limit:
            return cleaned
        return cleaned[:limit].rstrip() + "\n..."

    def _accumulate_usage(self, usage: dict[str, Any]) -> None:
        active_usage = _ACTIVE_USAGE.get()
        target = active_usage if active_usage is not None else self.total_tokens
        for key in target:
            value = usage.get(key, 0)
            if isinstance(value, (int, float)):
                target[key] += int(value)

    def _add_run_usage(self, usage: dict[str, int], cost: float) -> None:
        for key in self.total_tokens:
            self.total_tokens[key] += int(usage.get(key, 0))
        self.total_cost += cost

    def _cost_for_usage(self, usage: dict[str, int], member: ExpertMemberConfig) -> float:
        model_id = member.model or self.request.model
        if not model_id:
            return 0.0
        resolved = self.provider_registry.resolve_model(model_id, member.provider_id or self.request.provider_id)
        if not resolved:
            return 0.0
        _, model_info = resolved
        return calculate_step_cost(usage, model_info)

    def _retry_delay(self, attempt: int, error: Exception | None) -> float:
        base = 1.0
        message = str(error or "").lower()
        if "429" in message or "rate" in message:
            base = 5.0
        elif "timeout" in message or "timed out" in message or "econn" in message:
            base = 2.0
        delay = base * (2 ** attempt)
        jitter = random.uniform(0, delay * 0.25)
        return min(_MAX_RETRY_DELAY_SECONDS, delay + jitter)
