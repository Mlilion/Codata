from __future__ import annotations

import pytest

from app.knowledge import wiki_store
from app.models.knowledge_entry import KnowledgeEntry
from app.schemas.agent import AgentInfo
from app.tool.builtin import read_knowledge as read_knowledge_mod
from app.tool.builtin.read_knowledge import ReadKnowledgeTool
from app.tool.context import ToolContext


def _ctx() -> ToolContext:
    return ToolContext(
        session_id="test-session",
        message_id="test-msg",
        agent=AgentInfo(name="test", description="", mode="primary"),
        call_id="test-call",
    )


@pytest.mark.asyncio
async def test_read_wiki_page(tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    (wiki_store.wiki_dir() / "channel.md").write_text("# 渠道\n口径说明", encoding="utf-8")
    tool = ReadKnowledgeTool()
    res = await tool.execute({"page": "channel.md"}, _ctx())
    assert "口径说明" in res.output


@pytest.mark.asyncio
async def test_read_wiki_page_traversal_blocked(tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    tool = ReadKnowledgeTool()
    res = await tool.execute({"page": "../../etc/passwd"}, _ctx())
    assert res.error is not None


@pytest.mark.asyncio
async def test_read_wiki_page_directory_guarded(tmp_path, monkeypatch):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    # ensure the wiki dir exists so page="." resolves to the base dir itself
    wiki_store.wiki_dir().mkdir(parents=True, exist_ok=True)
    tool = ReadKnowledgeTool()
    res = await tool.execute({"page": "."}, _ctx())
    assert res.error is not None


@pytest.mark.asyncio
async def test_read_entry_id_file_source_reads_file(tmp_path, monkeypatch):
    # No index.md → falls through to the legacy entry_id branch.
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)

    entry = KnowledgeEntry(
        id="f1",
        source_type="file",
        source_name="报告.pdf",
        title="报告.pdf",
        file_path="/tmp/报告.pdf",
    )

    class _FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, model, key):
            return entry

    monkeypatch.setattr(read_knowledge_mod, "get_session_factory", lambda: _FakeSession)
    monkeypatch.setattr(
        "app.knowledge.ingest._extract_file", lambda p: "文件正文内容"
    )

    tool = ReadKnowledgeTool()
    res = await tool.execute({"entry_id": "f1"}, _ctx())
    assert res.error is None
    assert "文件正文内容" in res.output
    assert "报告.pdf" in res.output
