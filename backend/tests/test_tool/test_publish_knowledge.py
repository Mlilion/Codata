from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.tool.builtin import publish_knowledge as publish_knowledge_mod
from app.tool.builtin.publish_knowledge import PublishKnowledgeTool


@pytest.mark.asyncio
async def test_publish_knowledge_tool_imports_and_schedules(monkeypatch, tmp_path):
    tool = PublishKnowledgeTool()
    imported = SimpleNamespace(
        id="k1",
        title="Derived Note",
        source_name="note.md",
        file_path="/tmp/uploads/note.md",
    )
    captured: dict[str, object] = {}

    async def fake_import(session_factory, **kwargs):
        captured["session_factory"] = session_factory
        captured["kwargs"] = kwargs
        return imported

    def fake_schedule(**kwargs):
        captured["schedule"] = kwargs

    monkeypatch.setattr(publish_knowledge_mod, "import_local_file", fake_import)
    monkeypatch.setattr(publish_knowledge_mod, "schedule_knowledge_ingest", fake_schedule)

    ctx = SimpleNamespace(
        workspace=str(tmp_path),
        agent=SimpleNamespace(tools=[]),
        _app_state={
            "session_factory": "session-factory",
            "provider_registry": "provider-registry",
            "agent_registry": "agent-registry",
            "tool_registry": "tool-registry",
            "index_manager": "index-manager",
            "settings": "settings",
        },
    )

    result = await tool({"file_path": "docs/note.md", "title": "Derived Note"}, ctx)

    assert result.success
    assert captured["kwargs"]["workspace"] == str(tmp_path)
    assert captured["kwargs"]["file_path"] == "docs/note.md"
    assert captured["schedule"]["entry_id"] == "k1"
