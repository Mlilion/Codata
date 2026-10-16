"""Create expert teams tool."""

from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from app.config import get_settings
from app.expert.creation_access import check_expert_team_creation_access
from app.expert.generator import generate_expert_team_config
from app.expert.models import ExpertTeamConfig
from app.expert.validation import validate_expert_team_config
from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext


class CreateExpertTeamsTool(ToolDefinition):
    """Generate, validate, and optionally persist a Codata expert team."""

    @property
    def is_concurrency_safe(self) -> bool:
        return False

    @property
    def id(self) -> str:
        return "create_expert_teams"

    @property
    def description(self) -> str:
        return (
            "Create a Codata expert team from a natural-language requirement or a complete "
            "ExpertTeamConfig object. Use this when the user asks to create, design, scaffold, "
            "or publish a multi-agent expert team. The tool validates workflow references and "
            "can save the result into the user's expert-team registry."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Natural-language description of the expert team to generate.",
                },
                "team": {
                    "type": "object",
                    "description": "Optional complete ExpertTeamConfig. If provided, it is validated and can be saved.",
                },
                "save": {
                    "type": "boolean",
                    "description": "Whether to persist the team into the user expert-team directory. Defaults to false.",
                },
                "overwrite": {
                    "type": "boolean",
                    "description": "Whether an existing editable team with the same id may be overwritten. Defaults to false.",
                },
                "category": {
                    "type": "string",
                    "description": "Optional category hint, e.g. 技术工程, 数据智能, 研究咨询.",
                },
                "model": {
                    "type": "string",
                    "description": "Optional model id used when prompt-based generation is needed.",
                },
                "provider_id": {
                    "type": "string",
                    "description": "Optional provider id for model resolution.",
                },
            },
            "required": [],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        app_state = getattr(ctx, "_app_state", None) or {}
        team_registry = app_state.get("expert_team_registry") or getattr(self, "_expert_team_registry", None)
        role_registry = app_state.get("expert_role_registry") or getattr(self, "_expert_role_registry", None)
        provider_registry = app_state.get("provider_registry")
        settings = app_state.get("settings") or get_settings()
        if team_registry is None:
            return ToolResult(error="Expert team registry is not initialised.")

        save = bool(args.get("save", False))
        overwrite = bool(args.get("overwrite", False))
        model = args.get("model") or getattr(ctx, "_model_id", None)
        provider_id = args.get("provider_id") or getattr(ctx, "_provider_id", None)

        access = check_expert_team_creation_access(
            settings=settings,
            provider_registry=provider_registry,
            provider_id=provider_id,
            model=model,
        )
        if not access.allowed:
            return ToolResult(
                error=access.message,
                title="需要模型提供商",
                metadata=access.detail,
            )

        if isinstance(args.get("team"), dict):
            result = self._from_team_payload(args["team"])
        else:
            prompt = str(args.get("prompt") or "").strip()
            if not prompt:
                return ToolResult(error="Either prompt or team must be provided.")
            if role_registry is None or provider_registry is None:
                return ToolResult(error="Provider and expert role registries are required for prompt-based generation.")
            try:
                result = await generate_expert_team_config(
                    prompt=prompt,
                    provider_registry=provider_registry,
                    role_registry=role_registry,
                    model=model,
                    provider_id=provider_id,
                    category=args.get("category"),
                )
            except Exception as exc:
                return ToolResult(error=f"Failed to generate expert team: {exc}")

        team = result.get("team")
        if team is None:
            errors = result.get("validation_errors") or ["Invalid expert team payload"]
            return ToolResult(
                error="Expert team validation failed: " + "; ".join(errors),
                metadata={"errors": errors},
            )
        errors = result.get("validation_errors") or validate_expert_team_config(team)
        if errors and save:
            return ToolResult(
                error="Expert team validation failed: " + "; ".join(errors),
                metadata={"errors": errors},
            )
        if not _has_save_permission(ctx):
            save = False

        saved = False
        if save:
            existing = team_registry.get(team.id)
            if existing is not None and not overwrite:
                return ToolResult(
                    error=f'Expert team "{team.id}" already exists. Set overwrite=true to replace an editable team.',
                    metadata={"team_id": team.id},
                )
            try:
                team_registry.save_user_team(team)
                saved = True
            except Exception as exc:
                return ToolResult(error=f"Failed to save expert team: {exc}")

        output = {
            "saved": saved,
            "team_id": team.id,
            "team": team.model_dump(mode="json"),
            "explanation": result.get("explanation", ""),
            "role_choices": result.get("role_choices", []),
            "warnings": result.get("warnings", []),
            "cost_level": result.get("cost_level"),
            "validation_errors": errors,
        }
        ctx.publish_metadata(
            title=("已保存专家团" if saved else "已生成专家团草稿"),
            metadata={"team_id": team.id, "name": team.name, "saved": saved, "validation_errors": errors},
        )
        return ToolResult(
            output=json.dumps(output, ensure_ascii=False, indent=2),
            title=("Created expert team" if saved else ("Generated expert team draft" if not errors else "Generated expert team draft with validation errors")),
            metadata={
                "team_id": team.id,
                "name": team.name,
                "saved": saved,
                "validation_errors": errors,
            },
        )

    @staticmethod
    def _from_team_payload(payload: dict[str, Any]) -> dict[str, Any]:
        try:
            team = ExpertTeamConfig(**payload)
        except ValidationError as exc:
            errors = [".".join(str(part) for part in err.get("loc", [])) + f": {err.get('msg')}" for err in exc.errors()]
            return {"team": None, "validation_errors": errors}
        return {
            "team": team,
            "validation_errors": validate_expert_team_config(team),
            "explanation": str(team.metadata.get("generation_notes") or ""),
            "role_choices": [],
            "warnings": [],
            "cost_level": team.metadata.get("cost_level"),
        }


def _has_save_permission(ctx: ToolContext) -> bool:
    return not ctx.agent.tools or "create_expert_teams" in ctx.agent.tools
