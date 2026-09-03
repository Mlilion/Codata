"""publish_knowledge - import a local markdown file into the knowledge base."""

from __future__ import annotations

from typing import Any

from app.knowledge.source_import import (
    import_local_file,
    schedule_knowledge_ingest,
)
from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext


class PublishKnowledgeTool(ToolDefinition):

    @property
    def id(self) -> str:
        return "publish_knowledge"

    @property
    def description(self) -> str:
        return (
            "Import a final workspace file into the knowledge base and trigger "
            "wiki generation. Use this after extracting a markdown knowledge doc "
            "the user wants preserved in the KB."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute or workspace-relative path to the file to publish",
                },
                "title": {
                    "type": "string",
                    "description": "Optional knowledge entry title override",
                },
                "note": {
                    "type": "string",
                    "description": "Optional note saved with the knowledge entry",
                },
            },
            "required": ["file_path"],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        app_state = getattr(ctx, "_app_state", None)
        if not app_state:
            return ToolResult(error="Knowledge publishing unavailable: missing app state")
        required = ["session_factory", "provider_registry", "agent_registry", "tool_registry"]
        missing = [key for key in required if not app_state.get(key)]
        if missing:
            return ToolResult(
                error=f"Knowledge publishing unavailable: missing {', '.join(missing)}"
            )

        try:
            entry = await import_local_file(
                app_state["session_factory"],
                file_path=args["file_path"],
                workspace=ctx.workspace,
                title=args.get("title"),
                note=args.get("note"),
            )
        except (FileNotFoundError, IsADirectoryError, ValueError) as exc:
            return ToolResult(error=str(exc))

        schedule_knowledge_ingest(
            entry_id=entry.id,
            session_factory=app_state["session_factory"],
            provider_registry=app_state["provider_registry"],
            agent_registry=app_state["agent_registry"],
            tool_registry=app_state["tool_registry"],
            index_manager=app_state.get("index_manager"),
            settings=app_state.get("settings"),
        )

        label = entry.title or entry.source_name or entry.id
        return ToolResult(
            output=f"Published knowledge file: {label}",
            title=f"Published {label}",
            metadata={
                "entry_id": entry.id,
                "file_path": entry.file_path,
                "source_name": entry.source_name,
                "title": entry.title,
            },
        )
