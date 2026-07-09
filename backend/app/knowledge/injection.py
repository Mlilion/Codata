"""Render the registered Feishu knowledge docs into a system-prompt section."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.knowledge_entry import KnowledgeEntry

MAX_LISTED = 50


async def build_knowledge_section(
    session_factory: async_sessionmaker[AsyncSession],
) -> str | None:
    """Build a <knowledge-base> section listing enabled docs, or None if empty."""
    async with session_factory() as session:
        rows = (await session.execute(
            select(KnowledgeEntry)
            .where(KnowledgeEntry.enabled == True)  # noqa: E712
            .order_by(KnowledgeEntry.time_created.desc())
            .limit(MAX_LISTED)
        )).scalars().all()

    if not rows:
        return None

    lines = []
    for e in rows:
        label = e.title or e.feishu_url
        note = f" — {e.note}" if e.note else ""
        lines.append(f"- [{e.id}] {label}{note}")
    body = "\n".join(lines)
    return (
        "<knowledge-base>\n"
        "以下是用户登记的飞书知识文档。回答业务问题前先看这个清单,若某篇相关,"
        "调用 read_knowledge(entry_id) 读取其正文作为权威背景,并在回答中注明来源:\n"
        f"{body}\n"
        "</knowledge-base>"
    )
