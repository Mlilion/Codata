from __future__ import annotations

import pytest

from app.knowledge import ingest, wiki_store
from app.models.knowledge_entry import KnowledgeEntry


class _FakeSettings:
    def __init__(self, model="", provider=""):
        self.default_model = model
        self.default_provider_id = provider


@pytest.mark.asyncio
async def test_ingest_uses_default_model(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    async with session_factory() as s:
        s.add(KnowledgeEntry(id="m1", feishu_url="u", feishu_token="t", doc_type="docx"))
        await s.commit()

    async def fake_snapshot(entry):
        return "raw/m1.md"

    captured = {}

    async def fake_run_generation(job, req, *a, **k):
        captured["model"] = req.model
        captured["provider_id"] = req.provider_id
        return None

    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", lambda *a, **k: _noop())
    monkeypatch.setattr(
        ingest, "resolve_default_model", lambda reg, st: ("kaon/claude-opus-4-8", "custom_x")
    )

    await ingest.ingest_entry(
        "m1",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
        settings=_FakeSettings("kaon/claude-opus-4-8", "custom_x"),
    )

    assert captured["model"] == "kaon/claude-opus-4-8"
    assert captured["provider_id"] == "custom_x"


async def _noop():
    return True


@pytest.mark.asyncio
async def test_ingest_no_settings_falls_back_to_none(tmp_path, monkeypatch, session_factory):
    monkeypatch.setattr(wiki_store, "_resolve_data_dir", lambda: tmp_path)
    async with session_factory() as s:
        s.add(KnowledgeEntry(id="m2", feishu_url="u", feishu_token="t", doc_type="docx"))
        await s.commit()

    async def fake_snapshot(entry):
        return "raw/m2.md"

    captured = {}

    async def fake_run_generation(job, req, *a, **k):
        captured["model"] = req.model
        return None

    monkeypatch.setattr(ingest, "snapshot_raw", fake_snapshot)
    monkeypatch.setattr(ingest, "run_generation", fake_run_generation)
    monkeypatch.setattr(ingest, "delete_by_id", lambda *a, **k: _noop())

    await ingest.ingest_entry(
        "m2",
        session_factory=session_factory,
        provider_registry=object(),
        agent_registry=object(),
        tool_registry=object(),
        settings=None,   # no settings → model stays None (fallback)
    )

    assert captured["model"] is None
