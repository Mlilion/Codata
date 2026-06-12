"""ToolSearch — lets agents discover deferred MCP tool schemas on demand.

MCP tools are not included in the LLM ``tools`` parameter by default to save
tokens.  Instead, their names are listed in the ToolSearch description.  When
the LLM calls ``tool_search``, matching tool schemas are returned as text and
the tools are marked "discovered" so they appear in subsequent LLM calls.
"""

from __future__ import annotations

import json
from typing import Any

from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext
from app.tool.registry import ToolRegistry


class ToolSearchTool(ToolDefinition):
    """Meta-tool that discovers deferred (MCP) tool schemas on demand."""

    # Budget: max tools listed in description, max chars per description line.
    _MAX_LISTED = 50
    _MAX_DESC_CHARS = 80

    def __init__(self, tool_registry: ToolRegistry) -> None:
        self._tool_registry = tool_registry

    # ------------------------------------------------------------------
    # ToolDefinition interface
    # ------------------------------------------------------------------

    @property
    def id(self) -> str:
        return "tool_search"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        """Dynamic description listing deferred tool names."""
        base = (
            "Fetch full schema definitions for deferred tools so they can "
            "be called.\n\n"
            "Deferred tools are listed below by name. Until you fetch their "
            "schemas via this tool, they cannot be called — the LLM does not "
            "receive their parameter definitions.\n\n"
            "After calling this tool, the matched tools become available in "
            "subsequent turns with full schemas.\n\n"
            "Query forms:\n"
            '- "select:tool_name" or "select:tool1,tool2" — fetch exact tools by name\n'
            '- "keyword1 keyword2" — keyword search, returns up to max_results matches'
        )

        deferred = self._get_deferred_tools()
        if not deferred:
            return base + "\n\nNo deferred tools are currently available."

        shown = deferred[: self._MAX_LISTED]
        remaining = len(deferred) - len(shown)

        lines = [base, "", "Available deferred tools:"]
        for tool in shown:
            desc = tool.description or ""
            # Strip MCP prefix for brevity in listing
            if desc.startswith("[MCP:"):
                desc = desc.split("]", 1)[-1].strip()
            if len(desc) > self._MAX_DESC_CHARS:
                desc = desc[: self._MAX_DESC_CHARS - 3] + "..."
            lines.append(f"- {tool.id}: {desc}")

        if remaining > 0:
            lines.append(f"  (and {remaining} more — search by keyword to find them)")

        return "\n".join(lines)

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        'Search query. Use "select:tool_name" for exact match, '
                        "or keywords for fuzzy search."
                    ),
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default: 5).",
                },
            },
            "required": ["query"],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        query: str = args.get("query", "")
        max_results: int = args.get("max_results", 5)

        deferred = self._get_deferred_tools()
        if not deferred:
            return ToolResult(output="No deferred tools available.", title="Tool search")

        # --- Match ---
        if query.startswith("select:"):
            names = {n.strip() for n in query[7:].split(",") if n.strip()}
            matches = [t for t in deferred if t.id in names]
        else:
            matches = self._keyword_search(query, deferred, max_results)

        if not matches:
            available = ", ".join(t.id for t in deferred[:20])
            return ToolResult(
                output=f"No matching deferred tools for query: {query}\n\nAvailable: {available}",
                title="Tool search: no results",
            )

        # --- Mark discovered ---
        if ctx.discovered_tools is not None:
            for tool in matches:
                ctx.discovered_tools.add(tool.id)

        # --- Return full schemas ---
        sections: list[str] = []
        for tool in matches:
            spec = tool.to_openai_spec()["function"]
            sections.append(
                f"### {spec['name']}\n"
                f"{spec['description']}\n\n"
                f"Parameters:\n```json\n"
                f"{json.dumps(spec['parameters'], indent=2, ensure_ascii=False)}\n"
                f"```"
            )

        output = "\n\n".join(sections)
        ctx.publish_metadata(title=f"Found {len(matches)} tool(s)")
        return ToolResult(
            output=output,
            title=f"Found {len(matches)} tool(s)",
            metadata={"discovered": [t.id for t in matches]},
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_deferred_tools(self) -> list[ToolDefinition]:
        """Return all MCP-wrapped tools (candidates for deferral)."""
        from app.mcp.tool_wrapper import McpToolWrapper

        return [
            t for t in self._tool_registry.all_tools()
            if isinstance(t, McpToolWrapper)
        ]

    @staticmethod
    def _keyword_search(
        query: str,
        tools: list[ToolDefinition],
        max_results: int,
    ) -> list[ToolDefinition]:
        """Simple keyword scoring on tool id + description."""
        keywords = query.lower().split()
        if not keywords:
            return tools[:max_results]

        scored: list[tuple[int, ToolDefinition]] = []
        for tool in tools:
            text = f"{tool.id} {tool.description}".lower()
            score = 0
            for kw in keywords:
                if kw in text:
                    # Exact word in id scores higher
                    if kw in tool.id.lower().split("_"):
                        score += 3
                    else:
                        score += 1
            if score > 0:
                scored.append((score, tool))

        scored.sort(key=lambda x: -x[0])
        return [t for _, t in scored[:max_results]]
