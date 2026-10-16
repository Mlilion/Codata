from __future__ import annotations

import pytest

from app.models.knowledge_entry import KnowledgeEntry


def test_ingest_fields_default():
    e = KnowledgeEntry(feishu_url="https://x", feishu_token="tok", doc_type="docx")
    assert e.ingest_status == "pending"
    assert e.ingest_error == ""
    assert e.raw_path == ""
    assert e.wiki_pages == ""
