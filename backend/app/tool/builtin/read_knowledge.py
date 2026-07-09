"""read_knowledge — list registered Feishu knowledge docs and read one on demand."""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select

from app.dependencies import get_session_factory
from app.knowledge.feishu_reader import find_feishu_client, read_feishu_doc
from app.models.knowledge_entry import KnowledgeEntry
from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext

logger = logging.getLogger(__name__)

MAX_DOC_CHARS = 8000


class ReadKnowledgeTool(ToolDefinition):

    @property
    def id(self) -> str:
        return "read_knowledge"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return (
            "Access the user's registered Feishu knowledge base. Call with no "
            "arguments to list the registered documents (id, title, note). Call "
            "with an 'entry_id' to read that document's full text as authoritative "
            "background. Cite the source link in your answer when you use it."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "entry_id": {
                    "type": "string",
                    "description": "ID of a registered knowledge doc to read. Omit to list all.",
                },
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        entry_id = args.get("entry_id")
        factory = get_session_factory()

        if not entry_id:
            async with factory() as session:
                rows = (await session.execute(
                    select(KnowledgeEntry).where(KnowledgeEntry.enabled == True)  # noqa: E712
                )).scalars().all()
            listing = [
                {"id": e.id, "title": e.title or e.feishu_url, "note": e.note, "type": e.doc_type}
                for e in rows
            ]
            if not listing:
                return ToolResult(output="知识库为空,用户尚未登记任何飞书文档。")
            return ToolResult(output=json.dumps(listing, ensure_ascii=False))

        async with factory() as session:
            entry = await session.get(KnowledgeEntry, entry_id)
        if entry is None:
            return ToolResult(error=f"知识条目不存在: {entry_id}")

        client = find_feishu_client()
        if client is None:
            return ToolResult(error="飞书未连接。请先在连接器中授权飞书,才能读取文档。")

        try:
            body = await read_feishu_doc(client, entry.doc_type, entry.feishu_token)
        except Exception as exc:  # surface for self-correction
            logger.warning("read_feishu_doc failed: %s", exc)
            return ToolResult(error=f"读取飞书文档失败: {exc}")

        if len(body) > MAX_DOC_CHARS:
            body = body[:MAX_DOC_CHARS] + "\n…(内容过长已截断)"
        header = f"文档《{entry.title or entry.feishu_url}》(来源: {entry.feishu_url})\n\n"
        return ToolResult(output=header + body)
