"""Access checks for creating user expert teams."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

EXPERT_TEAM_CREATION_ACCESS_CODE = "expert_team_creation_requires_provider"
EXPERT_TEAM_ACCOUNT_REDIRECT = "/settings?tab=providers"
EXPERT_TEAM_CREATION_ACCESS_MESSAGE = (
    "Create an expert team after selecting a model provider in Settings."
)
PRIVATE_EXPERT_TEAM_PROVIDER_IDS = frozenset({"workcraft-proxy"})


@dataclass(frozen=True)
class ExpertTeamCreationAccess:
    allowed: bool
    provider_id: str
    detail: dict[str, Any]

    @property
    def message(self) -> str:
        return str(self.detail.get("message") or EXPERT_TEAM_CREATION_ACCESS_MESSAGE)


def check_expert_team_creation_access(
    *,
    settings: Any,
    provider_registry: Any | None = None,
    provider_id: str | None = None,
    model: str | None = None,
) -> ExpertTeamCreationAccess:
    """Return whether the current request may create a user expert team."""

    resolved_provider_id = _resolve_provider_id(
        provider_registry=provider_registry,
        provider_id=provider_id,
        model=model,
    )
    if _is_private_provider_id(resolved_provider_id):
        resolved_provider_id = ""
    allowed = bool(resolved_provider_id)
    return ExpertTeamCreationAccess(
        allowed=allowed,
        provider_id=resolved_provider_id,
        detail={
            "code": EXPERT_TEAM_CREATION_ACCESS_CODE,
            "message": EXPERT_TEAM_CREATION_ACCESS_MESSAGE,
            "redirect": EXPERT_TEAM_ACCOUNT_REDIRECT,
            "required_provider_id": "",
            "provider_id": resolved_provider_id or None,
            "model": str(model or "").strip() or None,
        },
    )


def assert_expert_team_creation_access(
    *,
    settings: Any,
    provider_registry: Any | None = None,
    provider_id: str | None = None,
    model: str | None = None,
) -> ExpertTeamCreationAccess:
    access = check_expert_team_creation_access(
        settings=settings,
        provider_registry=provider_registry,
        provider_id=provider_id,
        model=model,
    )
    if not access.allowed:
        raise HTTPException(status_code=402, detail=access.detail)
    return access


def _resolve_provider_id(
    *,
    provider_registry: Any | None,
    provider_id: str | None,
    model: str | None,
) -> str:
    clean_provider = str(provider_id or "").strip()
    if clean_provider:
        if provider_registry is None:
            return ""
        return _resolve_explicit_provider_id(
            provider_registry=provider_registry,
            provider_id=clean_provider,
            model=str(model or "").strip(),
        )

    model_id = str(model or "").strip()
    if not model_id or provider_registry is None:
        return ""

    return _resolve_model_provider_id(
        provider_registry=provider_registry,
        model_id=model_id,
        provider_id=None,
    )


def _resolve_explicit_provider_id(
    *,
    provider_registry: Any,
    provider_id: str,
    model: str,
) -> str:
    if model:
        return _resolve_model_provider_id(
            provider_registry=provider_registry,
            model_id=model,
            provider_id=provider_id,
        )

    get_provider = getattr(provider_registry, "get_provider", None)
    if callable(get_provider):
        try:
            provider = get_provider(provider_id)
        except Exception:
            return ""
        if not provider:
            return ""
        return str(getattr(provider, "id", "") or provider_id).strip()

    all_models = getattr(provider_registry, "all_models", None)
    if callable(all_models):
        try:
            models = all_models()
        except Exception:
            return ""
        for available_model in models or []:
            if str(getattr(available_model, "provider_id", "") or "").strip() == provider_id:
                return provider_id
    return ""


def _resolve_model_provider_id(
    *,
    provider_registry: Any,
    model_id: str,
    provider_id: str | None,
) -> str:
    resolve_model = getattr(provider_registry, "resolve_model", None)
    if not callable(resolve_model):
        return ""

    try:
        resolved = resolve_model(model_id, provider_id)
    except TypeError:
        try:
            resolved = resolve_model(model_id)
        except Exception:
            return ""
    except Exception:
        return ""
    if not resolved:
        return ""
    provider, _model_info = resolved
    resolved_provider_id = str(getattr(provider, "id", "") or "").strip()
    if provider_id and resolved_provider_id != provider_id:
        return ""
    return resolved_provider_id


def _is_private_provider_id(provider_id: str) -> bool:
    return provider_id in PRIVATE_EXPERT_TEAM_PROVIDER_IDS
