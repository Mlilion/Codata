from __future__ import annotations

import json

import pytest

from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry


@pytest.mark.asyncio
async def test_cleanup_entry_success_deletes_row_and_raw(
    tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    raw = wiki_store.raw_dir() / "c1.md"
    raw.write_text("body", encoding="utf-8")
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="c1", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="deleting", raw_path="raw/c1.md",
            wiki_pages=json.dumps(["log.md", "source-c1.md"]),
        ))
        await s.commit()

    captured = {}

    async def fake_run_generation(job, req, *a, **k):
        captured["session_id"] = req.session_id
        return None

    deleted = []

    async def fake_delete_by_id(db, model, id):
        deleted.append((model, id))
        return True

    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await ingest.cleanup_entry(
        "c1",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    async with session_factory() as s:
        assert await s.get(KnowledgeEntry, "c1") is None   # row gone
    assert not raw.exists()                                # raw snapshot gone
    # throwaway cleanup session deleted too
    assert (ingest.Session, captured["session_id"]) in deleted


@pytest.mark.asyncio
async def test_cleanup_entry_failure_keeps_row_and_raw(
    tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    raw = wiki_store.raw_dir() / "c2.md"
    raw.write_text("body", encoding="utf-8")
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="c2", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="deleting", raw_path="raw/c2.md",
            wiki_pages=json.dumps(["source-c2.md"]),
        ))
        await s.commit()

    async def boom(job, req, *a, **k):
        raise RuntimeError("agent 崩了")

    monkeypatch.setattr(ingest, "run_generation", boom)

    # must not raise
    await ingest.cleanup_entry(
        "c2",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    async with session_factory() as s:
        e = await s.get(KnowledgeEntry, "c2")
        assert e is not None
        assert e.ingest_status == "failed"
        assert "agent 崩了" in e.ingest_error
    assert raw.exists()   # raw snapshot preserved for retry


@pytest.mark.asyncio
async def test_cleanup_entry_no_source_page_skips_agent(
    tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    raw = wiki_store.raw_dir() / "c3.md"
    raw.write_text("body", encoding="utf-8")
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="c3", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="deleting", raw_path="raw/c3.md",
            wiki_pages=json.dumps(["log.md"]),   # no source-*.md
        ))
        await s.commit()

    ran = {"agent": False}

    async def fake_run_generation(job, req, *a, **k):
        ran["agent"] = True
        return None

    async def fake_delete_by_id(db, model, id):
        return True

    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await ingest.cleanup_entry(
        "c3",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    assert ran["agent"] is False                 # agent skipped
    async with session_factory() as s:
        assert await s.get(KnowledgeEntry, "c3") is None
    assert not raw.exists()


@pytest.mark.asyncio
async def test_cleanup_entry_prunes_deleted_source_from_index(
    tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    shared = wiki_store.wiki_dir() / "shared-topic.md"
    shared.write_text("# Shared\n", encoding="utf-8")
    index = wiki_store.index_path()
    index.write_text(
        "# 知识库索引\n\n"
        "## 实体\n"
        "| 页面 | 摘要 |\n"
        "| --- | --- |\n"
        "| [source-c4.md](source-c4.md) | deleted |\n"
        "| [shared-topic.md](shared-topic.md) | keep |\n",
        encoding="utf-8",
    )
    raw = wiki_store.raw_dir() / "c4.md"
    raw.write_text("body", encoding="utf-8")
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="c4", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="deleting", raw_path="raw/c4.md",
            wiki_pages=json.dumps(["source-c4.md"]),
        ))
        await s.commit()

    async def fake_run_generation(job, req, *a, **k):
        return None

    async def fake_delete_by_id(db, model, id):
        return True

    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await ingest.cleanup_entry(
        "c4",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    assert index.exists()
    text = index.read_text(encoding="utf-8")
    assert "source-c4.md" not in text
    assert "shared-topic.md" in text


@pytest.mark.asyncio
async def test_cleanup_entry_deletes_empty_index_file(
    tmp_path, monkeypatch, session_factory
):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    index = wiki_store.index_path()
    index.write_text(
        "# 知识库索引\n\n"
        "## 实体\n"
        "| 页面 | 摘要 |\n"
        "| --- | --- |\n"
        "| [source-c5.md](source-c5.md) | deleted |\n",
        encoding="utf-8",
    )
    raw = wiki_store.raw_dir() / "c5.md"
    raw.write_text("body", encoding="utf-8")
    async with session_factory() as s:
        s.add(KnowledgeEntry(
            id="c5", feishu_url="u", feishu_token="t", doc_type="docx",
            ingest_status="deleting", raw_path="raw/c5.md",
            wiki_pages=json.dumps(["source-c5.md"]),
        ))
        await s.commit()

    async def fake_run_generation(job, req, *a, **k):
        return None

    async def fake_delete_by_id(db, model, id):
        return True

    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", fake_delete_by_id)

    await ingest.cleanup_entry(
        "c5",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
    )

    assert not index.exists()
