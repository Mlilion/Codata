"""Tool adapter for expert team runs."""

from __future__ import annotations

from app.agent.permission import evaluate, merge_rulesets
from app.schemas.agent import AgentInfo, PermissionRule, Ruleset
from app.tool.registry import ToolRegistry


class ExpertToolAdapter:
    """Expose WorkCraft tools to expert members through OpenAI tool schemas."""

    def __init__(self, tool_registry: ToolRegistry) -> None:
        self._tool_registry = tool_registry

    def build_agent(self, *, name: str, description: str, tools: list[str]) -> AgentInfo:
        return AgentInfo(
            name=name,
            description=description,
            mode="subagent",
            tools=tools,
            permissions=Ruleset(
                rules=[
                    PermissionRule(action="allow", permission="*"),
                    PermissionRule(action="ask", permission="bash"),
                    PermissionRule(action="ask", permission="write"),
                    PermissionRule(action="ask", permission="edit"),
                    PermissionRule(action="allow", permission="skill"),
                ]
            ),
            system_prompt=None,
        )

    def specs(self, agent: AgentInfo, ruleset: Ruleset, discovered_tools: set[str] | None = None) -> list[dict]:
        return self._tool_registry.to_openai_specs(
            agent,
            extra_ruleset=ruleset,
            discovered=discovered_tools,
        )

    def allowed_tools(self, agent: AgentInfo, ruleset: Ruleset) -> set[str]:
        merged = merge_rulesets(agent.permissions, ruleset)
        return {
            tool.id
            for tool in self._tool_registry.resolve_for_agent(agent, extra_ruleset=merged)
            if evaluate(tool.id, "*", merged) != "deny"
        }
