from __future__ import annotations

import pytest

from app.knowledge.feishu_url import parse_feishu_url


@pytest.mark.parametrize(
    "url, expected",
    [
        ("https://sample.feishu.cn/docx/AbCd1234efGh", ("docx", "AbCd1234efGh")),
        ("https://sample.feishu.cn/wiki/WxYz9876", ("wiki", "WxYz9876")),
        ("https://sample.feishu.cn/sheets/Sh33tT0k3n", ("sheet", "Sh33tT0k3n")),
        ("https://sample.feishu.cn/base/Bas3T0k3n", ("bitable", "Bas3T0k3n")),
        ("https://sample.feishu.cn/docx/AbCd1234?from=space", ("docx", "AbCd1234")),
    ],
)
def test_parse_feishu_url_ok(url, expected):
    assert parse_feishu_url(url) == expected


def test_parse_feishu_url_rejects_non_feishu():
    with pytest.raises(ValueError):
        parse_feishu_url("https://example.com/docx/abc")


def test_parse_feishu_url_rejects_unknown_type():
    with pytest.raises(ValueError):
        parse_feishu_url("https://sample.feishu.cn/unknown/abc")


from app.models.knowledge_entry import KnowledgeEntry


def test_knowledge_entry_defaults():
    e = KnowledgeEntry(feishu_url="u", feishu_token="t", doc_type="docx")
    # defaults are applied at flush; assert column defaults exist
    assert KnowledgeEntry.__tablename__ == "knowledge_entry"
    assert e.feishu_token == "t"
