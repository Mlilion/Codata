"""Teams API — list available expert teams (custom agents with skills/mcps)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.dependencies import AgentRegistryDep

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("")
async def list_teams(
    registry: AgentRegistryDep,
) -> list[dict]:
    """List all agents that have skills or mcps defined (Expert Teams)."""
    teams = []
    for agent in registry.list_agents(include_hidden=False):
        # Include agents that have skills or mcps (Expert Teams)
        # Also include all primary agents for browsing (even without skills/mcps)
        if agent.skills or agent.mcps or agent.mode == "primary":
            teams.append({
                "name": agent.name,
                "description": agent.description,
                "mode": agent.mode,
                "skills": agent.skills,
                "mcps": agent.mcps,
                "system_prompt_preview": agent.system_prompt[:200] if agent.system_prompt else None,
                "domain": agent.metadata.get("domain", "general"),
                "icon": agent.metadata.get("icon", "🤖"),
            })
    return teams


@router.get("/{team_name}")
async def get_team_detail(
    team_name: str,
    registry: AgentRegistryDep,
) -> dict:
    """Get full details of a specific team."""
    agent = registry.get(team_name)
    if not agent:
        raise HTTPException(status_code=404, detail="Team not found")
    return {
        "name": agent.name,
        "description": agent.description,
        "mode": agent.mode,
        "skills": agent.skills,
        "mcps": agent.mcps,
        "system_prompt": agent.system_prompt,
        "permissions": agent.permissions.model_dump(),
        "metadata": agent.metadata,
    }