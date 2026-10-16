"""Tests for the Feishu knowledge-base system-prompt injection."""

from __future__ import annotations

from app.agent.agent import AgentRegistry
from app.knowledge.injection import build_knowledge_section
from app.models.knowledge_entry import KnowledgeEntry


def test_knowledge_gate_targets_primary_agents():
    """The prompt assembler injects the wiki for agents whose mode == 'primary'.

    Guards the widened gate: build/plan/data (primary) get the knowledge base;
    internal agents (title/compaction/summary, mode 'hidden') do not. The
    default selectedAgent is 'build', so gating on the data agent alone left
    the wiki built-but-unused.
    """
    registry = AgentRegistry()
    for name in ("build", "plan", "data"):
        agent = registry.get(name)
        assert agent is not None, name
        assert hasattr(agent, "mode")
        assert agent.mode == "primary", name
    for name in ("title", "compaction", "summary"):
        assert registry.get(name).mode == "hidden", name


async def test_build_knowledge_section_none_when_empty(tmp_path, monkeypatch, session_factory):
    from app.knowledge import wiki_store
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    # db_engine (and thus session_factory) is a fresh in-memory DB per test,
    # so an untouched factory has no enabled entries.
    section = await build_knowledge_section(session_factory)
    assert section is None


async def test_build_knowledge_section_lists_enabled(tmp_path, monkeypatch, session_factory):
    from app.knowledge import wiki_store
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
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
