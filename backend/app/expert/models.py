"""Expert team configuration models."""

from __future__ import annotations

from enum import Enum
import re
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

_ID_PATTERN = r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$"
_RESERVED_EXPERT_IDS = {"__manager__"}


class ExpertTeamProcess(str, Enum):
    """Supported expert team execution processes."""

    SEQUENTIAL = "sequential"
    HIERARCHICAL = "hierarchical"
    WORKFLOW = "workflow"


class ExpertDependsOnMode(str, Enum):
    """How a task should treat multiple upstream dependencies."""

    ALL = "all"
    ANY_COMPLETED = "any_completed"


class ExpertContextPolicy(str, Enum):
    """How dependency outputs are passed into an expert task prompt."""

    AUTO = "auto"
    EXPLICIT = "explicit"
    DEPENDENCIES = "dependencies"
    SUMMARY = "summary"


class ExpertInteractionMode(str, Enum):
    """How an expert team may pause for user-provided context."""

    AUTO = "auto"
    ASK_FIRST = "ask_first"
    OFF = "off"


class ExpertQuestionTimeoutAction(str, Enum):
    """How an expert team proceeds when the user does not answer in time."""

    CONTINUE_WITH_ASSUMPTIONS = "continue_with_assumptions"
    FAIL_TASK = "fail_task"


class ExpertFinalizationMode(str, Enum):
    """How the expert team should produce the final user-facing answer."""

    COORDINATOR = "coordinator"
    LAST_TASK = "last_task"
    DELIVERABLE = "deliverable"
    NONE = "none"


class ExpertOutputStyle(str, Enum):
    """How expert task text should appear in the chat surface."""

    CONCISE = "concise"
    FULL = "full"


class ExpertDeliverableType(str, Enum):
    """Supported final deliverable categories."""

    MARKDOWN = "markdown"
    HTML = "html"
    PDF = "pdf"
    DOCX = "docx"
    XLSX = "xlsx"
    PPTX = "pptx"
    IMAGE = "image"
    VIDEO = "video"
    CODE = "code"
    ARTIFACT = "artifact"


class ExpertDeliverablePresentation(str, Enum):
    """How a final deliverable should be surfaced to the user."""

    ARTIFACT_PANEL = "artifact_panel"
    FILE_PREVIEW = "file_preview"
    BOTH = "both"


class ExpertDeliverableConfig(BaseModel):
    """Final user-facing artifact contract for an expert team."""

    required: bool = True
    type: ExpertDeliverableType = ExpertDeliverableType.MARKDOWN
    title: str = "最终产物"
    filename_template: str | None = None
    source: str = "last_task"
    presentation: ExpertDeliverablePresentation = ExpertDeliverablePresentation.BOTH
    tools: list[str] = Field(default_factory=lambda: ["write", "present_file"])

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        value = str(value).strip()
        return value or "最终产物"

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        value = str(value).strip()
        return value or "last_task"

    @field_validator("filename_template")
    @classmethod
    def validate_filename_template(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = str(value).strip()
        return value or None


class ExpertManagerSubmode(str, Enum):
    """How a hierarchical manager plans delegated work."""

    COORDINATED = "coordinated"
    AUTONOMOUS = "autonomous"


class ExpertFinalizationConfig(BaseModel):
    """Final delivery behavior after process execution."""

    mode: ExpertFinalizationMode = ExpertFinalizationMode.DELIVERABLE
    member: str | None = Field(default=None, pattern=_ID_PATTERN)
    tools: list[str] = Field(default_factory=list)
    deliverable: ExpertDeliverableConfig | None = None


class ExpertManagerConfig(BaseModel):
    """Manager configuration for hierarchical expert teams."""

    member: str | None = Field(default=None, pattern=_ID_PATTERN)
    prompt: str = (
        "You are the manager of this expert team. Plan the work, delegate concrete tasks to the right "
        "coworkers, ask follow-up questions to coworkers when needed, and synthesize a final answer for the user."
    )
    submode: ExpertManagerSubmode = ExpertManagerSubmode.COORDINATED


class ExpertInputOptionConfig(BaseModel):
    """A selectable option for a team input collected during preflight."""

    label: str = Field(..., min_length=1)
    description: str = ""
    value: str | None = None
    preview: str | None = None


class ExpertInputConfig(BaseModel):
    """A named input available to workflow task templates."""

    name: str = Field(..., min_length=1, pattern=_ID_PATTERN)
    description: str = ""
    required: bool = True
    default: str | None = None
    required_when_setting_missing: str | None = None
    options: list[ExpertInputOptionConfig] = Field(default_factory=list)


class ExpertTaskLoopConfig(BaseModel):
    """Runtime loop metadata for workflow tasks."""

    back_to: str = Field(..., min_length=1, pattern=_ID_PATTERN)
    max_iterations: int = Field(default=2, ge=1, le=10)
    exit_condition: str = Field(..., min_length=1)


class ExpertMemberConfig(BaseModel):
    """A single expert in a team."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    role: str = Field(..., min_length=1)
    goal: str = Field(..., min_length=1)
    backstory: str = ""
    role_ref: str | None = None
    role_source: str | None = None
    system_prompt: str | None = None
    model: str | None = None
    provider_id: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1)
    tools: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    connectors: list[str] = Field(default_factory=list)
    icon: str = "bot"
    color: str | None = None

    @field_validator("id")
    @classmethod
    def validate_member_id(cls, value: str) -> str:
        value = str(value).strip()
        if not _is_valid_runtime_ref(value):
            raise ValueError(f"Must match {_ID_PATTERN} or be one of: {', '.join(sorted(_RESERVED_EXPERT_IDS))}")
        return value


class ExpertTaskConfig(BaseModel):
    """A task assigned to an expert team member."""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str = ""
    task: str | None = None
    expected_output: str = ""
    member: str = Field(..., min_length=1)
    context: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    depends_on_mode: ExpertDependsOnMode = ExpertDependsOnMode.ALL
    output: str | None = Field(default=None, pattern=_ID_PATTERN)
    context_policy: ExpertContextPolicy = ExpertContextPolicy.AUTO
    context_max_chars: int = Field(default=12000, ge=500, le=100000)
    condition: str | None = None
    timeout_seconds: int = Field(default=300, ge=1)
    retry_count: int = Field(default=1, ge=0, le=5)
    max_tool_rounds: int | None = Field(default=None, ge=1, le=30)
    output_schema: dict[str, Any] | None = None
    loop: ExpertTaskLoopConfig | None = None
    @field_validator("id")
    @classmethod
    def validate_task_id(cls, value: str) -> str:
        value = str(value).strip()
        if not _is_valid_runtime_ref(value):
            raise ValueError(f"Must match {_ID_PATTERN} or be one of: {', '.join(sorted(_RESERVED_EXPERT_IDS))}")
        return value

    @field_validator("member")
    @classmethod
    def validate_member_id(cls, value: str) -> str:
        value = str(value).strip()
        if not _is_valid_runtime_ref(value):
            raise ValueError(f"Must match {_ID_PATTERN} or be one of: {', '.join(sorted(_RESERVED_EXPERT_IDS))}")
        return value

    @model_validator(mode="after")
    def sync_legacy_fields(self) -> "ExpertTaskConfig":
        """Keep older description/context configs compatible with workflow fields."""
        if not self.task and self.description:
            self.task = self.description
        if not self.description and self.task:
            self.description = self.task
        if not self.task:
            raise ValueError("Task description is required")

        if not self.depends_on and self.context:
            self.depends_on = list(self.context)
        if not self.context and self.depends_on:
            self.context = list(self.depends_on)
        return self


class ExpertTeamConfig(BaseModel):
    """Complete expert team definition."""

    id: str = Field(..., min_length=1, pattern=_ID_PATTERN)
    name: str = Field(..., min_length=1)
    description: str = ""
    icon: str = "users"
    version: str = "1.0"
    process: ExpertTeamProcess = ExpertTeamProcess.SEQUENTIAL
    concurrency: int = Field(default=1, ge=1, le=8)
    inputs: list[ExpertInputConfig] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    category: str = "general"
    members: list[ExpertMemberConfig] = Field(..., min_length=1)
    tasks: list[ExpertTaskConfig] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    connectors: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    default_max_tool_rounds: int = Field(default=6, ge=1, le=30)
    finalization: ExpertFinalizationConfig = Field(default_factory=ExpertFinalizationConfig)
    manager: ExpertManagerConfig | None = None
    max_delegations: int = Field(default=12, ge=1, le=50)
    interaction_mode: ExpertInteractionMode = ExpertInteractionMode.AUTO
    max_clarifying_questions: int = Field(default=4, ge=0, le=8)
    question_timeout_seconds: int = Field(default=300, ge=30, le=1800)
    on_question_timeout: ExpertQuestionTimeoutAction = ExpertQuestionTimeoutAction.CONTINUE_WITH_ASSUMPTIONS
    expert_output_style: ExpertOutputStyle = ExpertOutputStyle.CONCISE
    expert_visible_max_chars: int = Field(default=1800, ge=500, le=20000)
    coordinator_visible_max_chars: int = Field(default=2400, ge=500, le=30000)
    coordinator_context_policy: ExpertContextPolicy = ExpertContextPolicy.SUMMARY
    coordinator_context_max_chars: int = Field(default=24000, ge=1000, le=200000)
    coordinator_prompt: str = (
        "You are the coordinator of this expert team. Synthesize the expert outputs into a final answer "
        "for the user. Keep useful details, resolve conflicts, and make the next actions clear."
    )

    @field_validator("tasks")
    @classmethod
    def validate_task_refs(
        cls,
        tasks: list[ExpertTaskConfig],
        info: Any,
    ) -> list[ExpertTaskConfig]:
        members = info.data.get("members") or []
        member_ids = {member.id for member in members}
        task_ids = {task.id for task in tasks}
        for task in tasks:
            if task.member not in member_ids:
                raise ValueError(f"Task '{task.id}' references unknown member '{task.member}'")
            for dep in task.depends_on or task.context:
                if dep not in task_ids:
                    raise ValueError(f"Task '{task.id}' references unknown context task '{dep}'")
            if task.loop and task.loop.back_to not in task_ids:
                raise ValueError(f"Task '{task.id}' loop references unknown task '{task.loop.back_to}'")
        return tasks

    @model_validator(mode="after")
    def validate_team_shape(self) -> "ExpertTeamConfig":
        """Validate cross-field process settings that depend on the whole team."""
        member_ids = {member.id for member in self.members}
        manager = self.manager

        reserved_members = member_ids & _RESERVED_EXPERT_IDS
        if reserved_members:
            raise ValueError(f"Member id is reserved for runtime use: {', '.join(sorted(reserved_members))}")
        reserved_tasks = {task.id for task in self.tasks} & _RESERVED_EXPERT_IDS
        if reserved_tasks:
            raise ValueError(f"Task id is reserved for runtime use: {', '.join(sorted(reserved_tasks))}")

        if manager and manager.member and manager.member not in member_ids:
            raise ValueError(f"Manager references unknown member '{manager.member}'")

        if self.finalization.member and self.finalization.member not in member_ids:
            raise ValueError(f"Finalization references unknown member '{self.finalization.member}'")

        if self.process == ExpertTeamProcess.HIERARCHICAL:
            if manager is None:
                manager = ExpertManagerConfig()
                self.manager = manager
            if "finalization" not in self.model_fields_set:
                self.finalization = ExpertFinalizationConfig(mode=ExpertFinalizationMode.DELIVERABLE)
            if not self.tasks and manager.submode != ExpertManagerSubmode.AUTONOMOUS:
                raise ValueError("Hierarchical coordinated teams require at least one suggested task")
        elif not self.tasks:
            raise ValueError("Expert teams require at least one task")

        return self


class ExpertTeamSummary(BaseModel):
    """Expert team list item."""

    id: str
    name: str
    description: str
    icon: str
    process: ExpertTeamProcess
    tags: list[str]
    category: str
    member_count: int
    task_count: int
    is_preset: bool
    editable: bool
    origin: str = "user"
    source: str | None = None
    remote_id: str | None = None
    remote_version: str | None = None
    remote_channel: str | None = None
    members: list[dict[str, str]]


class ExpertTeamDetailResponse(BaseModel):
    """Expert team detail plus registry metadata."""

    team: ExpertTeamConfig
    is_preset: bool
    editable: bool
    origin: str = "user"
    source: str | None = None
    remote_id: str | None = None
    remote_version: str | None = None
    remote_channel: str | None = None


class ExpertTeamListResponse(BaseModel):
    """Expert team catalog response."""

    teams: list[ExpertTeamSummary]


class ExpertTeamSummonRequest(BaseModel):
    """Request body for starting an expert team session."""

    input: str = Field(..., min_length=1)
    session_id: str | None = None
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    model: str | None = None
    provider_id: str | None = None
    workspace: str | None = None
    permission_presets: dict[str, bool] | None = None
    permission_rules: list[dict[str, Any]] | None = None
    reasoning: bool | None = None
    resume_from_task_id: str | None = Field(default=None, min_length=1)

    @field_validator("resume_from_task_id")
    @classmethod
    def validate_resume_task_id(cls, value: str | None) -> str | None:
        return _validate_optional_runtime_ref(value)


class ExpertTeamResumeRequest(BaseModel):
    """Request body for resuming an expert team run inside an existing session."""

    from_task_id: str = Field(..., min_length=1)
    input: str | None = None
    attachments: list[dict[str, Any]] | None = None
    model: str | None = None
    provider_id: str | None = None
    workspace: str | None = None
    permission_presets: dict[str, bool] | None = None
    permission_rules: list[dict[str, Any]] | None = None
    reasoning: bool | None = None

    @field_validator("from_task_id")
    @classmethod
    def validate_from_task_id(cls, value: str) -> str:
        return _validate_runtime_ref(value, field_name="from_task_id")


class ExpertTeamSummonResponse(BaseModel):
    """Response after starting an expert team run."""

    stream_id: str
    session_id: str


class ExpertTeamGenerateRequest(BaseModel):
    """Request body for AI-assisted expert team creation."""

    prompt: str = Field(..., min_length=8)
    category: str | None = None
    model: str | None = None
    provider_id: str | None = None
    role_limit: int = Field(default=60, ge=8, le=120)


class ExpertTeamGenerateResponse(BaseModel):
    """Generated expert team draft plus validation and generation metadata."""

    team: ExpertTeamConfig
    validation_errors: list[str] = Field(default_factory=list)
    explanation: str = ""
    role_choices: list[dict[str, str]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    cost_level: str | None = None
    model: str | None = None
    provider_id: str | None = None


class ExpertTeamValidateRequest(BaseModel):
    """Request body for validating an expert team draft."""

    team: ExpertTeamConfig


class ExpertTeamValidateResponse(BaseModel):
    """Validation result for an expert team draft."""

    valid: bool
    errors: list[str] = Field(default_factory=list)


def _is_valid_runtime_ref(value: str) -> bool:
    return bool(re.fullmatch(_ID_PATTERN, value)) or value in _RESERVED_EXPERT_IDS


def _validate_runtime_ref(value: Any, *, field_name: str) -> str:
    text = str(value).strip()
    if not text:
        raise ValueError(f"{field_name} is required")
    if _is_valid_runtime_ref(text):
        return text
    raise ValueError(f"{field_name} must match {_ID_PATTERN} or be one of: {', '.join(sorted(_RESERVED_EXPERT_IDS))}")


def _validate_optional_runtime_ref(value: Any) -> str | None:
    if value is None:
        return None
    return _validate_runtime_ref(value, field_name="resume_from_task_id")
