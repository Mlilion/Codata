"""Render the registered Feishu knowledge docs into a system-prompt section."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.knowledge import wiki_store
from app.models.knowledge_entry import KnowledgeEntry

MAX_LISTED = 50
MAX_INDEX_CHARS = 6000


async def build_knowledge_section(
    session_factory: async_sessionmaker[AsyncSession],
) -> str | None:
    """Inject the LLM-generated wiki index.md, falling back to the legacy listing."""
    idx = wiki_store.index_path()
    if idx.exists():
        text = idx.read_text(encoding="utf-8").strip()
        if text:
            if len(text) > MAX_INDEX_CHARS:
                text = text[:MAX_INDEX_CHARS] + "\n…(索引过长已截断)"
            return (
                "<knowledge-base>\n"
                "以下是知识库的索引(index.md)。回答业务问题前先看它定位相关页面,"
                "然后用文件读取工具读 wiki 目录下对应的 .md 页面作为权威背景,"
                "并沿页面中的 [[双链]] 补全上下文,回答时注明来源:\n\n"
                f"{text}\n"
                "</knowledge-base>"
            )
    return await _legacy_listing_section(session_factory)


async def _legacy_listing_section(
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
