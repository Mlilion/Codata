from __future__ import annotations
from app.knowledge.ingest_prompt import build_ingest_prompt
from app.models.knowledge_entry import KnowledgeEntry

def test_prompt_mentions_key_pieces():
    e = KnowledgeEntry(id="e1", feishu_url="https://x", feishu_token="t", doc_type="docx", title="渠道口径说明")
    p = build_ingest_prompt(e, "raw/e1.md", "/data/knowledge-wiki/wiki")
    assert "raw/e1.md" in p
    assert "/data/knowledge-wiki/wiki" in p
    assert "index.md" in p
    assert "log.md" in p
    assert "source-" in p           # 摘要页命名约定
    assert "渠道口径说明" in p        # 标题带入
    assert "[[" in p                 # 双链约定


def test_prompt_source_label_for_file_entry():
    e = KnowledgeEntry(id="f1", source_type="file", source_name="报告.pdf", title="报告.pdf")
    p = build_ingest_prompt(e, "raw/f1.pdf", "/data/knowledge-wiki/wiki")
    assert "报告.pdf" in p            # 文件名作为来源
    assert "来源:None" not in p      # 不再泄漏 None
