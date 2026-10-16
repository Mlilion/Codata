from __future__ import annotations

import pytest

from app.knowledge import injection, wiki_store


@pytest.mark.asyncio
async def test_injects_index_when_present(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    wiki_store.index_path().write_text(
        "# Wiki 索引\n## 实体\n| [渠道](channel.md) | 渠道口径 |",
        encoding="utf-8",
    )
    section = await injection.build_knowledge_section(session_factory)
    assert section is not None
    assert "渠道口径" in section
    assert "wiki" in section.lower()  # 指示读 wiki 目录


@pytest.mark.asyncio
async def test_none_when_no_index_and_no_entries(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    assert await injection.build_knowledge_section(session_factory) is None
