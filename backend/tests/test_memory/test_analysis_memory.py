"""Tests for structured analysis memory: storage, extraction parse, injection."""

from __future__ import annotations

import pytest

from app.memory.analysis_memory_storage import (
    MAX_METRICS,
    MAX_TOPICS,
    empty_memory,
    get_analysis_memory,
    trim_memory,
    upsert_analysis_memory,
)
from app.memory.analysis_memory_updater import (
    build_extraction_prompt,
    parse_analysis_memory_response,
)


class TestTrim:
    def test_empty(self):
        assert trim_memory({}) == empty_memory()
        assert trim_memory("garbage") == empty_memory()

    def test_metrics_sorted_and_capped(self):
        data = {"frequent_metrics": [{"name": f"m{i}", "count": i} for i in range(30)]}
        out = trim_memory(data)
        assert len(out["frequent_metrics"]) == MAX_METRICS
        # highest count first
        assert out["frequent_metrics"][0]["count"] == 29

    def test_prefs_deduped(self):
        out = trim_memory({"caliber_preferences": ["a", "a", "b", "  ", "c"]})
        assert out["caliber_preferences"] == ["a", "b", "c"]

    def test_topics_keep_recent(self):
        data = {"analysis_topics": [{"summary": f"t{i}"} for i in range(30)]}
        out = trim_memory(data)
        assert len(out["analysis_topics"]) == MAX_TOPICS
        assert out["analysis_topics"][-1]["summary"] == "t29"


class TestParse:
    def test_plain_json(self):
        assert parse_analysis_memory_response('{"frequent_metrics": []}') == {"frequent_metrics": []}

    def test_markdown_fenced(self):
        assert parse_analysis_memory_response('```json\n{"a": 1}\n```') == {"a": 1}

    def test_prose_wrapped(self):
        assert parse_analysis_memory_response('sure: {"a": 1} ok') == {"a": 1}

    def test_garbage_none(self):
        assert parse_analysis_memory_response("no json") is None
        assert parse_analysis_memory_response("") is None
        assert parse_analysis_memory_response("[1,2,3]") is None  # not an object

    def test_prompt_includes_current_and_conversation(self):
        p = build_extraction_prompt({"frequent_metrics": []}, "User: show DAU")
        assert "frequent_metrics" in p
        assert "show DAU" in p


@pytest.mark.asyncio
class TestStorageRoundTrip:
    async def test_upsert_then_get(self, session_factory):
        data = {
            "frequent_metrics": [{"name": "DAU", "count": 3}],
            "frequent_dimensions": [{"field": "channel", "count": 2}],
            "caliber_preferences": ["按周聚合"],
            "analysis_topics": [{"summary": "看了新增"}],
        }
        stored = await upsert_analysis_memory(session_factory, data, None)
        assert stored["frequent_metrics"][0]["name"] == "DAU"

        loaded = await get_analysis_memory(session_factory, None)
        assert loaded["frequent_dimensions"][0]["field"] == "channel"
        assert loaded["caliber_preferences"] == ["按周聚合"]

    async def test_get_empty_when_none(self, session_factory):
        loaded = await get_analysis_memory(session_factory, None)
        assert loaded == empty_memory()

    async def test_upsert_replaces(self, session_factory):
        await upsert_analysis_memory(session_factory, {"caliber_preferences": ["a"]}, None)
        await upsert_analysis_memory(session_factory, {"caliber_preferences": ["b"]}, None)
        loaded = await get_analysis_memory(session_factory, None)
        assert loaded["caliber_preferences"] == ["b"]  # single global row replaced


@pytest.mark.asyncio
class TestInjection:
    async def test_none_when_empty(self, session_factory):
        from app.memory.analysis_memory_injection import build_analysis_memory_section
        section = await build_analysis_memory_section(session_factory, None)
        assert section is None

    async def test_renders_when_present(self, session_factory):
        from app.memory.analysis_memory_injection import build_analysis_memory_section
        await upsert_analysis_memory(
            session_factory,
            {"frequent_metrics": [{"name": "DAU", "table": "t"}]},
            None,
        )
        section = await build_analysis_memory_section(session_factory, None)
        assert section is not None
        assert "<analysis-memory>" in section
        assert "DAU" in section


@pytest.mark.asyncio
class TestRecommendationsEndpoint:
    async def test_empty_returns_defaults(self, app_client):
        resp = await app_client.get("/api/analysis/recommendations")
        assert resp.status_code == 200
        recs = resp.json()["recommendations"]
        assert len(recs) >= 1

    async def test_history_based(self, app_client, session_factory):
        await upsert_analysis_memory(
            session_factory,
            {
                "frequent_metrics": [{"name": "DAU"}],
                "frequent_dimensions": [{"field": "渠道"}],
            },
            None,
        )
        resp = await app_client.get("/api/analysis/recommendations")
        recs = resp.json()["recommendations"]
        joined = " ".join(recs)
        assert "DAU" in joined
