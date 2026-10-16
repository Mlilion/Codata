from __future__ import annotations
from app.models.knowledge_entry import KnowledgeEntry


def test_source_defaults_feishu():
    e = KnowledgeEntry(feishu_url="https://x", feishu_token="t", doc_type="docx")
    assert e.source_type == "feishu"
    assert e.file_path == ""
    assert e.source_name == ""


def test_file_source_no_feishu_fields():
    e = KnowledgeEntry(source_type="file", file_path="data/uploads/x.pdf", source_name="x.pdf")
    assert e.source_type == "file"
    assert e.file_path == "data/uploads/x.pdf"
    assert e.source_name == "x.pdf"
    # feishu fields optional now
    assert e.feishu_url is None
    assert e.feishu_token is None
