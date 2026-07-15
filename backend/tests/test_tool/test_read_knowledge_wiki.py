from __future__ import annotations

import pytest

from app.knowledge import wiki_store
from app.schemas.agent import AgentInfo
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
