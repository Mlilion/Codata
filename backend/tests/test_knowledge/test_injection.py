"""Tests for the Feishu knowledge-base system-prompt injection."""

from __future__ import annotations

from app.knowledge.injection import build_knowledge_section
from app.models.knowledge_entry import KnowledgeEntry


async def test_build_knowledge_section_none_when_empty(session_factory):
    # db_engine (and thus session_factory) is a fresh in-memory DB per test,
    # so an untouched factory has no enabled entries.
    section = await build_knowledge_section(session_factory)
    assert section is None


async def test_build_knowledge_section_lists_enabled(session_factory):
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            feishu_url="https://x.feishu.cn/docx/T1", feishu_token="T1",
            doc_type="docx", title="客单价口径", note="AOV 定义", enabled=True,
        ))
        s.add(KnowledgeEntry(
            feishu_url="https://x.feishu.cn/docx/T2", feishu_token="T2",
            doc_type="docx", title="停用的", note="", enabled=False,
        ))
        await s.commit()

    section = await build_knowledge_section(session_factory)
    assert section is not None
    assert "<knowledge-base>" in section
    assert "客单价口径" in section
    assert "AOV 定义" in section
    assert "停用的" not in section  # disabled excluded
