from __future__ import annotations
from app.knowledge.cleanup_prompt import build_cleanup_prompt
from app.models.knowledge_entry import KnowledgeEntry


def test_cleanup_prompt_mentions_key_pieces():
    e = KnowledgeEntry(id="e1", feishu_url="https://x", feishu_token="t", doc_type="docx", title="渠道口径说明")
    p = build_cleanup_prompt(e, "source-channel.md", "/data/knowledge-wiki/wiki")
    assert "e1" in p                      # entry_id 带入
    assert "渠道口径说明" in p             # 标题带入
    assert "source-channel.md" in p       # source 页锚点
    assert "/data/knowledge-wiki/wiki" in p
    assert "[[" in p                      # 反向链检查约定
    assert "index.md" in p and "log.md" in p
    assert "孤儿" in p                     # 孤儿判定说明存在
    assert "grep" in p                    # 反向链孤儿判定的关键手段
    assert "remove" in p                  # log 记录格式


def test_cleanup_prompt_without_source_page():
    e = KnowledgeEntry(id="e2", title="无摘要页")
    p = build_cleanup_prompt(e, None, "/data/knowledge-wiki/wiki")
    assert "e2" in p
    assert "None" not in p                # 不泄漏 None 字面量
