"""Expert role library endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.dependencies import ExpertRoleRegistryDep
from app.expert.roles import ExpertRole, ExpertRoleListResponse, ExpertRoleRegistry

router = APIRouter(prefix="/expert-roles", tags=["expert-roles"])


@router.get("", response_model=ExpertRoleListResponse)
async def list_expert_roles(registry: ExpertRoleRegistryDep) -> ExpertRoleListResponse:
    return _role_response(registry)


@router.post("/refresh", response_model=ExpertRoleListResponse)
async def refresh_expert_roles(registry: ExpertRoleRegistryDep) -> ExpertRoleListResponse:
    registry.refresh()
    return _role_response(registry)


@router.get("/{role_path:path}", response_model=ExpertRole)
async def get_expert_role(role_path: str, registry: ExpertRoleRegistryDep) -> ExpertRole:
    role = registry.get(role_path)
    if role is None:
        raise HTTPException(status_code=404, detail="Expert role not found")
    return role


def _role_response(registry: ExpertRoleRegistry) -> ExpertRoleListResponse:
    return ExpertRoleListResponse(
        roles=registry.list_roles(),
        source_dirs=registry.source_dirs,
        active_language=registry.active_language,
        using_fallback=registry.using_fallback,
        missing_preferred_dirs=registry.missing_preferred_dirs,
    )
