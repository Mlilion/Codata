"""AI-assisted expert team generation helpers."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import ValidationError

from app.expert.models import ExpertTeamConfig
from app.expert.roles import ExpertRole, ExpertRoleRegistry
from app.expert.validation import validate_expert_team_config
from app.provider.registry import ProviderRegistry
from app.schemas.agent import AgentInfo, PermissionRule, Ruleset
from app.schemas.provider import ModelInfo
from app.utils.id import generate_ulid

logger = logging.getLogger(__name__)

_ID_RE = re.compile(r"[^a-zA-Z0-9_-]+")

_SYSTEM_PROMPT = """你是 Codata 的专家团架构师，负责把用户需求转换成可执行的 ExpertTeamConfig JSON。

规则：
- 只输出 JSON，不要 Markdown，不要代码块。
- 专家团必须能被 Codata 原生专家团运行器执行。
- 优先从给定的 agency-agents-zh 角色库选择成员，并把 role_ref/role_source/system_prompt 写入成员。
- 成员数量通常 2-5 个；任务数量通常 2-7 个；除非需求明确需要，不要过度拆分。
- 先判断流程复杂度再选择 process：简单固定顺序用 sequential；固定 DAG/可并发流程用 workflow；需要 manager 统筹、动态委派、跨角色反复协调、长链路或需求边界不确定时用 hierarchical。
- hierarchical 必须提供 manager、max_delegations 和 finalization；coordinated 子模式把 tasks 当作建议计划，autonomous 子模式可以没有 tasks，由 manager 动态派活。
- 每个 task 必须有稳定 id、name、task、expected_output、member、depends_on、context、output。
- task 模板只能引用 {{user_input}}、{{workspace}}、团队 inputs、以及上游任务的 output 变量。
- 如果 task 引用上游 output，必须在 depends_on/context 中包含生产该 output 的任务。
- context_policy 优先用 auto；大输出或汇总任务用 summary；需要严格模板变量时用 explicit。
- 每个 output 变量只能由一个任务生产。
- 工具只使用 Codata 内置工具名：read, glob, grep, search, web_search, web_fetch, skill, code_execute, write, edit, bash。
- 不要给普通专家成员配置 question 工具。运行器会在专家团开始前由协调员统一做资料预检和补充提问。
- 默认避免 write/edit/bash，只有用户需求明确需要落地改文件或运行命令时才给相关专家配置。
- coordinator_prompt 必须说明如何综合专家输出、解决冲突、给出下一步。
- expert_output_style 默认 concise；专家聊天区输出应直接、摘要性，完整细节通过 handoff、文件或 artifact 承载。
- 每个专家团都必须声明最终产物合同：finalization.mode 默认用 deliverable，finalization.deliverable 描述最终交付物类型、标题、展示方式和工具。
- 不能把最终交付设计成只返回一段文本；最后一步必须能交付文件、视频、网页、PDF、图片、代码包或 artifact 这类用户可领取的产物。
- hierarchical 也默认使用 deliverable 收口，manager 的最终输出可作为 source；只有用户明确要求不落地产物时才用 last_task 或 none。
- metadata.generated_by 必须是 create_expert_teams。
- metadata.process_decision 记录流程判定：selected_process、complexity_score、reasons。
- metadata.generation_notes 用中文解释角色选择、流程设计、token 消耗等级和注意事项。

返回 JSON 结构：
{
  "team": { ... ExpertTeamConfig ... },
  "explanation": "中文说明",
  "role_choices": [{"member_id":"...", "role_ref":"...", "reason":"..."}],
  "warnings": ["..."],
  "cost_level": "low|medium|high"
}
"""


async def generate_expert_team_config(
    *,
    prompt: str,
    provider_registry: ProviderRegistry,
    role_registry: ExpertRoleRegistry,
    model: str | None = None,
    provider_id: str | None = None,
    category: str | None = None,
    role_limit: int = 60,
) -> dict[str, Any]:
    """Generate and validate an expert team draft with the configured LLM."""
    provider, model_info = await _resolve_generation_model(
        provider_registry,
        model=model,
        provider_id=provider_id,
    )
    roles = _select_roles(role_registry.list_roles(), prompt, category=category, limit=role_limit)
    role_catalog = _format_role_catalog(roles)
    schema = _team_schema_hint()
    user_prompt = (
        f"用户需求：\n{prompt.strip()}\n\n"
        f"期望分类：{category or '由你判断'}\n\n"
        f"可选中文角色库（优先使用这些 role id）：\n{role_catalog}\n\n"
        f"ExpertTeamConfig 字段约束：\n{json.dumps(schema, ensure_ascii=False)}"
    )

    text = await _stream_json_text(
        provider,
        model_info,
        [
            {"role": "user", "content": user_prompt},
        ],
        system=_SYSTEM_PROMPT,
    )
    payload = _extract_json_object(text)

    team_raw = payload.get("team", payload)
    if not isinstance(team_raw, dict):
        raise ValueError("AI response did not include a team object")

    role_choices = payload.get("role_choices") if isinstance(payload, dict) else []
    warnings = payload.get("warnings") if isinstance(payload, dict) else []
    normalized = _normalize_generated_team(team_raw, prompt=prompt, category=category)
    try:
        team = ExpertTeamConfig(**normalized)
    except ValidationError as exc:
        errors = [_format_validation_error(exc)]
        draft = _fallback_team(normalized, prompt=prompt, category=category)
        try:
            team = ExpertTeamConfig(**draft)
        except ValidationError:
            raise ValueError(_format_validation_error(exc)) from exc
        return {
            "team": team,
            "validation_errors": errors,
            "explanation": str(payload.get("explanation") or ""),
            "role_choices": _normalize_role_choices(role_choices),
            "warnings": [str(item) for item in warnings] if isinstance(warnings, list) else [],
            "cost_level": str(payload.get("cost_level") or "medium"),
            "model": model_info.id,
            "provider_id": provider.id,
        }

    errors = validate_expert_team_config(team)
    if errors:
        return {
            "team": team,
            "validation_errors": errors,
            "explanation": str(payload.get("explanation") or team.metadata.get("generation_notes") or ""),
            "role_choices": _normalize_role_choices(role_choices),
            "warnings": [str(item) for item in warnings] if isinstance(warnings, list) else [],
            "cost_level": str(payload.get("cost_level") or team.metadata.get("cost_level") or "medium"),
            "model": model_info.id,
            "provider_id": provider.id,
        }

    return {
        "team": team,
        "validation_errors": [],
        "explanation": str(payload.get("explanation") or team.metadata.get("generation_notes") or ""),
        "role_choices": _normalize_role_choices(role_choices),
        "warnings": [str(item) for item in warnings] if isinstance(warnings, list) else [],
        "cost_level": str(payload.get("cost_level") or team.metadata.get("cost_level") or "medium"),
        "model": model_info.id,
        "provider_id": provider.id,
    }


async def _resolve_generation_model(
    provider_registry: ProviderRegistry,
    *,
    model: str | None,
    provider_id: str | None,
):
    model_id = model
    if not model_id:
        models = provider_registry.all_models()
        model_id = _pick_json_model(models, provider_id=provider_id)
        if not model_id and not models:
            try:
                await provider_registry.refresh_models()
            except Exception:
                logger.debug("Failed to refresh models for expert team generation", exc_info=True)
            models = provider_registry.all_models()
            model_id = _pick_json_model(models, provider_id=provider_id)
    if not model_id:
        raise ValueError("No available model for expert team generation")

    resolved = provider_registry.resolve_model(model_id, provider_id)
    if not resolved:
        try:
            await provider_registry.refresh_models()
            resolved = provider_registry.resolve_model(model_id, provider_id)
        except Exception:
            logger.debug("Failed to refresh models while resolving %s", model_id, exc_info=True)
    if not resolved:
        raise ValueError(f"Model not found: {model_id}")
    return resolved


def _pick_json_model(models: list[ModelInfo], *, provider_id: str | None) -> str | None:
    candidates = [m for m in models if not provider_id or m.provider_id == provider_id]
    if not candidates:
        candidates = models
    json_models = [m for m in candidates if getattr(m.capabilities, "json_output", False)]
    free_json = [m for m in json_models if m.pricing.prompt == 0 and m.pricing.completion == 0]
    if free_json:
        return free_json[0].id
    if json_models:
        return json_models[0].id
    free = [m for m in candidates if m.pricing.prompt == 0 and m.pricing.completion == 0]
    if free:
        return free[0].id
    return candidates[0].id if candidates else None


def _fallback_team(normalized: dict[str, Any], *, prompt: str, category: str | None) -> dict[str, Any]:
    """Produce a minimally valid team payload when semantic validation fails."""
    team = dict(normalized)
    team.setdefault("id", _slugify_id(category or "expert-team"))
    team.setdefault("name", category or prompt[:32] or "专家团")
    team.setdefault("members", [])
    team.setdefault("tasks", [])
    if not team.get("members"):
        team["members"] = [
            {"id": "expert-1", "name": "协调专家", "role": "协调", "goal": "协调任务执行。"},
        ]
    if not team.get("tasks"):
        team["tasks"] = [
            {
                "id": "task-1",
                "name": "初始分析",
                "member": team["members"][0]["id"],
                "task": prompt.strip(),
                "expected_output": "给出可执行的团队草稿。",
            }
        ]
    return team


def _slugify_id(value: str) -> str:
    slug = _ID_RE.sub("-", value.strip().lower()).strip("-")
    return slug or "expert-team"


async def _stream_json_text(provider, model_info: ModelInfo, messages: list[dict[str, Any]], *, system: str) -> str:
    chunks: list[str] = []
    response_format: dict[str, Any] | None = None
    if getattr(model_info.capabilities, "json_output", False):
        response_format = {"type": "json_object"}

    async for chunk in provider.stream_chat(
        model_info.id,
        messages,
        system=system,
        temperature=0.2,
        max_tokens=min(model_info.capabilities.max_output or 8192, 8192),
        response_format=response_format,
    ):
        if chunk.type == "text-delta":
            chunks.append(str(chunk.data.get("text") or ""))
        elif chunk.type == "error":
            raise ValueError(str(chunk.data.get("message") or "Model generation failed"))
    text = "".join(chunks).strip()
    if not text:
        raise ValueError("Model returned empty expert team draft")
    return text


def _select_roles(
    roles: list[ExpertRole],
    prompt: str,
    *,
    category: str | None,
    limit: int,
) -> list[ExpertRole]:
    if not roles:
        return []
    text = f"{prompt} {category or ''}".lower()
    keywords = [kw for kw in re.split(r"[\s,，。；;:/\\|_-]+", text) if len(kw) >= 2]

    scored: list[tuple[int, ExpertRole]] = []
    for role in roles:
        haystack = f"{role.id} {role.name} {role.description} {role.category}".lower()
        score = 0
        if category and category.lower() in haystack:
            score += 8
        for keyword in keywords:
            if keyword and keyword in haystack:
                score += 2
        if any(term in haystack for term in ["project-management", "product", "strategy"]):
            score += 1
        scored.append((score, role))
    scored.sort(key=lambda item: (-item[0], item[1].category, item[1].name))
    selected = [role for score, role in scored[:limit] if score > 0]
    if len(selected) < min(limit, 24):
        existing = {role.id for role in selected}
        for _score, role in scored:
            if role.id not in existing:
                selected.append(role)
                existing.add(role.id)
            if len(selected) >= min(limit, 40):
                break
    return selected[:limit]


def _format_role_catalog(roles: list[ExpertRole]) -> str:
    if not roles:
        return "未加载角色库。请自行定义中文专家角色，但仍保持 role_ref 为空。"
    lines: list[str] = []
    for role in roles:
        desc = role.description.replace("\n", " ").strip()
        if len(desc) > 140:
            desc = desc[:137] + "..."
        lines.append(f"- id={role.id}; name={role.name}; category={role.category}; description={desc}; source={role.source}")
    return "\n".join(lines)


def _team_schema_hint() -> dict[str, Any]:
    return {
        "id": "lowercase kebab id, e.g. market-research-team",
        "name": "中文名称",
        "description": "适用场景说明",
        "icon": "users|code|bar-chart-2|pen-tool|file-text",
        "version": "1.0",
        "process": "workflow|sequential|hierarchical",
        "concurrency": "1-8",
        "category": "技术工程|内容创作|数据智能|办公文档|研究咨询|设计创意|general",
        "tags": ["中文标签"],
        "default_max_tool_rounds": 6,
        "finalization": {
            "mode": "deliverable|coordinator|last_task|none",
            "member": "member id 或 null",
            "tools": ["read"],
            "deliverable": {
                "required": True,
                "type": "markdown|html|pdf|docx|xlsx|pptx|image|video|code|artifact",
                "title": "最终产物标题",
                "filename_template": "可选文件名模板，例如 deliverable.md",
                "source": "last_task|coordinator|某个 task id 或 output 变量",
                "presentation": "both|file_preview|artifact_panel",
                "tools": ["write", "present_file"]
            }
        },
        "manager": {"member": "member id 或 null", "prompt": "经理提示词", "submode": "coordinated|autonomous"},
        "max_delegations": 12,
        "members": [
            {
                "id": "planner",
                "name": "中文专家名",
                "role": "角色名",
                "goal": "清晰职责",
                "backstory": "可为空",
                "role_ref": "角色库 id 或 null",
                "role_source": "角色文件路径或 null",
                "system_prompt": "角色库正文或专用提示词",
                "tools": ["read", "grep", "skill"],
                "skills": [],
                "connectors": [],
                "icon": "bot",
            }
        ],
        "tasks": [
            {
                "id": "plan",
                "name": "中文任务名",
        "task": "可使用 {{user_input}} 和上游 output 变量。附件会由运行器自动传入，不要写 {{attachments}}。",
                "description": "与 task 相同",
                "expected_output": "期望输出",
                "member": "member id",
                "depends_on": [],
                "context": [],
                "depends_on_mode": "all",
                "output": "plan_result",
                "context_policy": "auto|explicit|dependencies|summary",
                "context_max_chars": 12000,
                "timeout_seconds": 300,
                "retry_count": 1,
                "max_tool_rounds": 6,
                "output_schema": None,
            }
        ],
        "skills": [],
        "connectors": [],
        "metadata": {
            "generated_by": "create_expert_teams",
            "generation_notes": "中文说明",
            "process_decision": {
                "selected_process": "workflow|sequential|hierarchical",
                "complexity_score": "0-100",
                "reasons": ["中文原因"],
            },
        },
        "interaction_mode": "auto",
        "max_clarifying_questions": 4,
        "question_timeout_seconds": 300,
        "on_question_timeout": "continue_with_assumptions|fail_task",
        "expert_output_style": "concise|full",
        "expert_visible_max_chars": 1800,
        "coordinator_visible_max_chars": 2400,
        "coordinator_context_policy": "summary",
        "coordinator_context_max_chars": 24000,
        "coordinator_prompt": "中文协调者提示词",
    }


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned).strip()
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Model response was not valid JSON") from None
        try:
            payload = json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError as exc:
            raise ValueError(f"Model response was not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Model response JSON must be an object")
    return payload


def _normalize_generated_team(raw: dict[str, Any], *, prompt: str, category: str | None) -> dict[str, Any]:
    data = dict(raw)
    name = str(data.get("name") or "AI 创建专家团").strip()
    data["name"] = name
    data["id"] = _slugify(str(data.get("id") or name), "expert-team")
    data.setdefault("description", prompt.strip()[:240])
    data.setdefault("icon", "users")
    data.setdefault("version", "1.0")
    data.setdefault("process", "workflow")
    data["concurrency"] = max(1, min(8, int(data.get("concurrency") or 2)))
    data["category"] = str(data.get("category") or category or "general")
    data["default_max_tool_rounds"] = max(1, min(30, int(data.get("default_max_tool_rounds") or 6)))
    data["tags"] = _string_list(data.get("tags"))
    data["skills"] = _string_list(data.get("skills"))
    data["connectors"] = _string_list(data.get("connectors"))
    data["interaction_mode"] = str(data.get("interaction_mode") or "auto")
    data["max_clarifying_questions"] = max(0, min(8, int(data.get("max_clarifying_questions") or 4)))
    data["question_timeout_seconds"] = max(30, min(1800, int(data.get("question_timeout_seconds") or 300)))
    timeout_action = str(data.get("on_question_timeout") or "continue_with_assumptions")
    data["on_question_timeout"] = timeout_action if timeout_action in {"continue_with_assumptions", "fail_task"} else "continue_with_assumptions"
    output_style = str(data.get("expert_output_style") or "concise")
    data["expert_output_style"] = output_style if output_style in {"concise", "full"} else "concise"
    data["expert_visible_max_chars"] = max(500, min(20000, int(data.get("expert_visible_max_chars") or 1800)))
    data["coordinator_visible_max_chars"] = max(500, min(30000, int(data.get("coordinator_visible_max_chars") or 2400)))
    data.setdefault("coordinator_context_policy", "summary")
    data["coordinator_context_max_chars"] = max(1000, min(200000, int(data.get("coordinator_context_max_chars") or 24000)))
    data.setdefault(
        "coordinator_prompt",
        "你是专家团协调者。请综合每位专家的输出，形成面向用户的最终答复，保留关键细节、解决冲突，并给出清晰的下一步建议。",
    )
    finalization = data.get("finalization") if isinstance(data.get("finalization"), dict) else {}
    finalization_mode_explicit = bool(str(finalization.get("mode") or "").strip())
    finalization = dict(finalization)
    finalization.setdefault("mode", "deliverable")
    finalization.setdefault("member", None)
    finalization["tools"] = _string_list(finalization.get("tools"))
    finalization["deliverable"] = _normalize_deliverable_config(finalization.get("deliverable"), prompt=prompt, data=data)
    data["finalization"] = finalization
    manager = data.get("manager") if isinstance(data.get("manager"), dict) else {}
    manager = dict(manager)
    manager.setdefault("member", None)
    manager.setdefault(
        "prompt",
        "You are the manager of this expert team. Plan the work, delegate concrete tasks to the right coworkers, ask follow-up questions to coworkers when needed, and synthesize a final answer for the user.",
    )
    manager.setdefault("submode", "coordinated")
    data["manager"] = manager
    data["max_delegations"] = max(1, min(50, int(data.get("max_delegations") or 12)))
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    metadata = dict(metadata)
    metadata.setdefault("generated_by", "create_expert_teams")
    metadata.setdefault("generation_prompt", prompt.strip())
    data["metadata"] = metadata

    members = data.get("members") if isinstance(data.get("members"), list) else []
    normalized_members: list[dict[str, Any]] = []
    member_id_map: dict[str, str] = {}
    for index, member in enumerate(members, start=1):
        if not isinstance(member, dict):
            continue
        item = dict(member)
        raw_member_id = str(item.get("id") or item.get("name") or f"expert-{index}")
        item["id"] = _slugify(raw_member_id, f"expert-{index}")
        item.setdefault("name", f"专家 {index}")
        item.setdefault("role", item["name"])
        item.setdefault("goal", "完成分配给自己的专业任务。")
        item.setdefault("backstory", "")
        item["tools"] = _safe_tools(_string_list(item.get("tools")) or ["read", "skill"])
        item["skills"] = _string_list(item.get("skills"))
        item["connectors"] = _string_list(item.get("connectors"))
        item.setdefault("icon", "bot")
        normalized_members.append(item)
        for key in {raw_member_id, str(item.get("name") or ""), str(item.get("role") or "")}:
            if key.strip():
                member_id_map[key] = item["id"]
    data["members"] = normalized_members

    member_ids = {member["id"] for member in normalized_members}
    tasks = data.get("tasks") if isinstance(data.get("tasks"), list) else []
    normalized_tasks: list[dict[str, Any]] = []
    task_id_map: dict[str, str] = {}
    output_id_map: dict[str, str] = {}
    for index, task in enumerate(tasks, start=1):
        if not isinstance(task, dict):
            continue
        item = dict(task)
        raw_task_id = str(item.get("id") or item.get("name") or f"task-{index}")
        item["id"] = _slugify(raw_task_id, f"task-{index}")
        item.setdefault("name", f"任务 {index}")
        for key in {raw_task_id, str(item.get("name") or "")}:
            if key.strip():
                task_id_map[key] = item["id"]
        normalized_tasks.append(item)

    for index, item in enumerate(normalized_tasks, start=1):
        text = str(item.get("task") or item.get("description") or "基于用户输入完成该步骤。")
        item["task"] = text
        item["description"] = text
        raw_member_ref = str(item.get("member") or "")
        item["member"] = member_id_map.get(raw_member_ref, raw_member_ref)
        if item.get("member") not in member_ids:
            item["member"] = normalized_members[0]["id"] if normalized_members else ""
        depends_on = [
            task_id_map.get(dep, dep)
            for dep in _string_list(item.get("depends_on") or item.get("context"))
        ]
        depends_on = [dep for dep in depends_on if dep != item["id"]]
        item["depends_on"] = depends_on
        item["context"] = depends_on
        item.setdefault("depends_on_mode", "all")
        output = item.get("output")
        raw_output = str(output).strip() if output else ""
        item["output"] = _varify(raw_output, f"{item['id'].replace('-', '_')}_result") if raw_output else f"{item['id'].replace('-', '_')}_result"
        if raw_output and raw_output != item["output"]:
            output_id_map[raw_output] = item["output"]
        item.setdefault("expected_output", "结构化输出。")
        item.setdefault("context_policy", "auto")
        item["context_max_chars"] = max(500, min(100000, int(item.get("context_max_chars") or 12000)))
        item["timeout_seconds"] = max(1, int(item.get("timeout_seconds") or 300))
        item["retry_count"] = max(0, min(5, int(item.get("retry_count") or 1)))
        raw_max_tool_rounds = item.get("max_tool_rounds")
        item["max_tool_rounds"] = None if raw_max_tool_rounds in {None, ""} else max(1, min(30, int(raw_max_tool_rounds)))
        item["output_schema"] = item.get("output_schema") if isinstance(item.get("output_schema"), dict) or item.get("output_schema") is None else None
    if output_id_map:
        for item in normalized_tasks:
            for key in ("task", "description", "condition"):
                if isinstance(item.get(key), str):
                    item[key] = _rewrite_template_refs(item[key], output_id_map)
            loop = item.get("loop")
            if isinstance(loop, dict) and isinstance(loop.get("exit_condition"), str):
                loop["exit_condition"] = _rewrite_template_refs(loop["exit_condition"], output_id_map)
    data["tasks"] = normalized_tasks
    _apply_process_decision(data, prompt=prompt, finalization_mode_explicit=finalization_mode_explicit)
    return data


def _apply_process_decision(
    data: dict[str, Any],
    *,
    prompt: str,
    finalization_mode_explicit: bool = False,
) -> None:
    """Choose a stable expert-team process after the model draft is normalized."""
    decision = _assess_process_complexity(data, prompt=prompt)
    requested_process = str(data.get("process") or "workflow").lower()
    selected_process = decision["selected_process"]
    if requested_process == "hierarchical" or decision["complexity_score"] >= 70:
        selected_process = "hierarchical"
    elif requested_process in {"workflow", "sequential"} and decision["complexity_score"] < 70:
        selected_process = requested_process

    decision["selected_process"] = selected_process
    decision["requested_process"] = requested_process
    data["process"] = selected_process
    if selected_process == "hierarchical":
        manager = data.get("manager") if isinstance(data.get("manager"), dict) else {}
        manager = dict(manager)
        member_ids = {str(member.get("id") or "") for member in data.get("members", []) if isinstance(member, dict)}
        manager_member = str(manager.get("member") or "").strip()
        if manager_member and manager_member not in member_ids:
            manager_member = ""
        manager["member"] = manager_member or None
        manager.setdefault(
            "prompt",
            "You are the manager of this expert team. Plan the work, delegate concrete tasks to the right coworkers, ask follow-up questions to coworkers when needed, and synthesize a final answer for the user.",
        )
        if manager.get("submode") not in {"coordinated", "autonomous"}:
            manager["submode"] = "coordinated" if data.get("tasks") else "autonomous"
        if not data.get("tasks"):
            manager["submode"] = "autonomous"
        data["manager"] = manager
        finalization = data.get("finalization") if isinstance(data.get("finalization"), dict) else {}
        finalization = dict(finalization)
        if not finalization_mode_explicit:
            finalization["mode"] = "deliverable"
        finalization["member"] = finalization.get("member") or None
        finalization["tools"] = _string_list(finalization.get("tools"))
        finalization["deliverable"] = _normalize_deliverable_config(finalization.get("deliverable"), prompt=prompt, data=data)
        data["finalization"] = finalization
        data["max_delegations"] = max(
            int(data.get("max_delegations") or 0),
            min(50, max(8, len(data.get("members", [])) * 3, len(data.get("tasks", [])) * 2)),
        )
    else:
        data["manager"] = None

    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    metadata = dict(metadata)
    metadata["process_decision"] = decision
    notes = str(metadata.get("generation_notes") or "").strip()
    decision_note = (
        f"流程判定：{selected_process}，复杂度 {decision['complexity_score']}，"
        f"原因：{'、'.join(decision['reasons'])}。"
    )
    metadata["generation_notes"] = f"{notes}\n{decision_note}".strip() if notes else decision_note
    data["metadata"] = metadata


def _assess_process_complexity(data: dict[str, Any], *, prompt: str) -> dict[str, Any]:
    """Return a deterministic process recommendation for AI-created teams."""
    text_parts = [
        prompt,
        str(data.get("name") or ""),
        str(data.get("description") or ""),
        str(data.get("category") or ""),
        " ".join(str(tag) for tag in data.get("tags", []) if tag),
    ]
    for task in data.get("tasks", []):
        if isinstance(task, dict):
            text_parts.extend([
                str(task.get("name") or ""),
                str(task.get("task") or task.get("description") or ""),
                str(task.get("expected_output") or ""),
            ])
    text = "\n".join(text_parts)
    lowered = text.lower()
    members = [member for member in data.get("members", []) if isinstance(member, dict)]
    tasks = [task for task in data.get("tasks", []) if isinstance(task, dict)]

    score = 0
    reasons: list[str] = []

    def add(points: int, reason: str) -> None:
        nonlocal score
        score += points
        if reason not in reasons:
            reasons.append(reason)

    if len(members) >= 4:
        add(16, f"{len(members)} 位专家需要跨角色协作")
    elif len(members) >= 3:
        add(8, f"{len(members)} 位专家参与")
    if len(tasks) >= 6:
        add(18, f"{len(tasks)} 个任务步骤，链路较长")
    elif len(tasks) >= 4:
        add(10, f"{len(tasks)} 个任务步骤")

    dependency_count = 0
    max_dep_width = 0
    for task in tasks:
        deps = _string_list(task.get("depends_on") or task.get("context"))
        dependency_count += len(deps)
        max_dep_width = max(max_dep_width, len(deps))
    if dependency_count >= 5 or max_dep_width >= 3:
        add(12, "依赖关系较多，需要统一调度")

    dynamic_terms = (
        "动态", "委派", "调度", "统筹", "经理", "manager", "hierarchical", "多轮", "反复",
        "协同", "协调", "审校", "评审", "质检", "仲裁", "验收", "跨团队", "多阶段",
        "复杂", "一站式", "端到端", "全流程", "持续", "跟进", "直到", "自动拆解",
    )
    matched_dynamic = [term for term in dynamic_terms if term in lowered]
    if matched_dynamic:
        add(min(30, 10 + len(matched_dynamic) * 3), "需求包含动态统筹或多轮协调信号")

    uncertain_terms = ("不确定", "按需", "视情况", "自动判断", "根据结果", "失败重试", "补充问题", "边界不明确")
    if any(term in lowered for term in uncertain_terms):
        add(16, "任务边界不确定，需要运行中决策")

    final_terms = ("生成", "落地", "实现", "发布", "完整方案", "交付", "最终产物", "文件", "代码", "视频", "报告")
    if sum(1 for term in final_terms if term in lowered) >= 3:
        add(8, "交付物复杂且需要最终整合")

    if any(isinstance(task.get("loop"), dict) for task in tasks):
        add(12, "存在循环迭代任务")
    if any(task.get("depends_on_mode") == "any_completed" for task in tasks):
        add(8, "存在条件汇聚任务")

    if len(tasks) <= 2 and len(members) <= 2 and score < 30:
        selected = "sequential"
        if not reasons:
            reasons.append("步骤少且协作关系简单")
    elif score >= 70:
        selected = "hierarchical"
    else:
        selected = "workflow"
        if not reasons:
            reasons.append("任务固定且适合按依赖图执行")

    return {
        "selected_process": selected,
        "complexity_score": min(100, score),
        "reasons": reasons[:6],
    }


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in re.split(r"[,，\n]", value) if item.strip()]
    return []


def _safe_tools(tools: list[str]) -> list[str]:
    allowed = {
        "read", "glob", "grep", "search", "web_search", "web_fetch", "skill", "code_execute",
        "write", "edit", "bash", "artifact", "present_file",
        # Data-analysis tools so generated (custom) analysis teams can query + chart.
        "run_query", "chart_spec", "tool_search",
    }
    return [tool for tool in tools if tool in allowed] or ["read", "skill"]


_DELIVERABLE_TYPES = {"markdown", "html", "pdf", "docx", "xlsx", "pptx", "image", "video", "code", "artifact"}
_DELIVERABLE_PRESENTATIONS = {"artifact_panel", "file_preview", "both"}


def _normalize_deliverable_config(value: Any, *, prompt: str, data: dict[str, Any]) -> dict[str, Any]:
    item = dict(value) if isinstance(value, dict) else {}
    deliverable_type = str(item.get("type") or _infer_deliverable_type(prompt, data)).strip().lower()
    if deliverable_type not in _DELIVERABLE_TYPES:
        deliverable_type = "markdown"

    title = str(item.get("title") or _default_deliverable_title(deliverable_type, prompt, data)).strip() or "最终产物"
    presentation = str(item.get("presentation") or _default_deliverable_presentation(deliverable_type)).strip().lower()
    if presentation not in _DELIVERABLE_PRESENTATIONS:
        presentation = _default_deliverable_presentation(deliverable_type)

    filename_template = item.get("filename_template")
    filename = str(filename_template).strip() if filename_template is not None else ""
    if not filename and deliverable_type not in {"artifact", "video", "image"}:
        filename = _default_deliverable_filename(deliverable_type, title)

    source = str(item.get("source") or "last_task").strip() or "last_task"
    tools = _string_list(item.get("tools")) or _default_deliverable_tools(deliverable_type, presentation)

    return {
        "required": bool(item.get("required", True)),
        "type": deliverable_type,
        "title": title,
        "filename_template": filename or None,
        "source": source,
        "presentation": presentation,
        "tools": tools,
    }


def _infer_deliverable_type(prompt: str, data: dict[str, Any]) -> str:
    text_parts = [
        prompt,
        str(data.get("name") or ""),
        str(data.get("description") or ""),
        str(data.get("category") or ""),
        " ".join(str(tag) for tag in data.get("tags", []) if tag),
    ]
    for task in data.get("tasks", []):
        if isinstance(task, dict):
            text_parts.extend([
                str(task.get("name") or ""),
                str(task.get("task") or task.get("description") or ""),
                str(task.get("expected_output") or ""),
            ])
    text = "\n".join(text_parts).lower()
    rules = [
        ("html", ("网页", "页面", "网站", "landing page", "html", "web page")),
        ("pdf", ("pdf", "白皮书", "正式报告", "可打印")),
        ("docx", ("word", "docx", "文档")),
        ("xlsx", ("excel", "xlsx", "表格", "数据表")),
        ("pptx", ("ppt", "pptx", "幻灯片", "演示文稿")),
        ("image", ("图片", "海报", "插画", "封面", "image")),
        ("code", ("代码", "项目", "脚本", "组件", "源码")),
        ("artifact", ("可视化", "交互", "artifact", "看板")),
    ]
    for deliverable_type, keywords in rules:
        if any(keyword in text for keyword in keywords):
            return deliverable_type
    if any(keyword in text for keyword in ("试题", "题库", "考试", "教案", "方案", "报告")):
        return "markdown"
    return "markdown"


def _default_deliverable_title(deliverable_type: str, prompt: str, data: dict[str, Any]) -> str:
    if deliverable_type == "video":
        return "最终视频"
    if deliverable_type == "html":
        return "最终网页"
    if deliverable_type == "pdf":
        return "最终 PDF"
    if deliverable_type == "image":
        return "最终图片"
    if deliverable_type == "code":
        return "最终代码产物"
    name = str(data.get("name") or "").strip()
    if name:
        return f"{name}最终产物"
    prompt_title = prompt.strip().splitlines()[0][:24]
    return f"{prompt_title}最终产物" if prompt_title else "最终产物"


def _default_deliverable_filename(deliverable_type: str, title: str) -> str:
    ext_by_type = {
        "markdown": ".md",
        "html": ".html",
        "pdf": ".pdf",
        "docx": ".docx",
        "xlsx": ".xlsx",
        "pptx": ".pptx",
        "code": ".md",
    }
    ext = ext_by_type.get(deliverable_type, ".md")
    safe = _ID_RE.sub("-", title.strip().lower()).strip("-_") or "deliverable"
    return f"{safe[:48]}{ext}"


def _default_deliverable_presentation(deliverable_type: str) -> str:
    if deliverable_type == "artifact":
        return "artifact_panel"
    if deliverable_type in {"html", "code"}:
        return "both"
    return "file_preview"


def _default_deliverable_tools(deliverable_type: str, presentation: str) -> list[str]:
    tools: list[str] = []
    if deliverable_type == "artifact" or presentation in {"artifact_panel", "both"}:
        tools.append("artifact")
    if deliverable_type in {"markdown", "html", "pdf", "docx", "xlsx", "pptx", "code"} or presentation in {"file_preview", "both"}:
        tools.extend(["write", "present_file"])
    if deliverable_type in {"pdf", "docx", "xlsx", "pptx"}:
        tools.append("code_execute")
    result: list[str] = []
    for tool in tools:
        if tool not in result:
            result.append(tool)
    return result or ["write", "present_file"]


def _slugify(value: str, fallback: str = "") -> str:
    slug = _ID_RE.sub("-", value.strip().lower()).strip("-_")
    if not slug:
        slug = _ID_RE.sub("-", fallback.strip().lower()).strip("-_") or generate_ulid().lower()
    if slug[0].isdigit():
        prefix = (_ID_RE.sub("-", fallback.strip().lower()).strip("-_").split("-", 1)[0] or "id")
        slug = f"{prefix}-{slug}"
    return slug[:48]


def _varify(value: str, fallback: str = "task_result") -> str:
    name = re.sub(r"[^a-zA-Z0-9_]+", "_", value.strip().lower()).strip("_")
    if not name:
        name = fallback
    if name[0].isdigit():
        name = f"result_{name}"
    return name[:48]


def _rewrite_template_refs(text: str, refs: dict[str, str]) -> str:
    rewritten = text
    for raw, normalized in refs.items():
        pattern = r"\{\{\s*" + re.escape(raw) + r"\s*\}\}"
        rewritten = re.sub(pattern, "{{" + normalized + "}}", rewritten)
    return rewritten


def _normalize_role_choices(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    choices: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        choices.append({
            "member_id": str(item.get("member_id") or ""),
            "role_ref": str(item.get("role_ref") or ""),
            "reason": str(item.get("reason") or ""),
        })
    return choices


def _format_validation_error(exc: ValidationError) -> str:
    messages: list[str] = []
    for error in exc.errors():
        loc = ".".join(str(part) for part in error.get("loc", []))
        messages.append(f"{loc}: {error.get('msg')}")
    return "; ".join(messages) or str(exc)


def create_tool_agent() -> AgentInfo:
    """Agent descriptor used for direct tool execution tests and schema docs."""
    return AgentInfo(
        name="expert-team-creator",
        description="Create Codata expert teams",
        mode="hidden",
        tools=["create_expert_teams"],
        permissions=Ruleset(rules=[
            PermissionRule(action="allow", permission="create_expert_teams"),
        ]),
    )
