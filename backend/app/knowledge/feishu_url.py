"""Parse a Feishu/Lark document URL into (doc_type, token).

Feishu cloud-doc URLs look like:
    https://<tenant>.feishu.cn/docx/<token>
    https://<tenant>.feishu.cn/wiki/<token>
    https://<tenant>.feishu.cn/sheets/<token>
    https://<tenant>.feishu.cn/base/<token>
We map the path segment to an internal doc_type and extract the token.
"""

from __future__ import annotations

from urllib.parse import urlparse

# path segment -> internal doc_type
_SEGMENT_TO_TYPE = {
    "docx": "docx",
    "docs": "docx",
    "wiki": "wiki",
    "sheets": "sheet",
    "sheet": "sheet",
    "base": "bitable",
    "bitable": "bitable",
}


def parse_feishu_url(url: str) -> tuple[str, str]:
    """Return (doc_type, token). Raise ValueError if not a recognised Feishu URL."""
    if not isinstance(url, str) or not url.strip():
        raise ValueError("链接不能为空")
    parsed = urlparse(url.strip())
    host = (parsed.netloc or "").lower()
    if "feishu.cn" not in host and "larksuite.com" not in host:
        raise ValueError("不是有效的飞书文档链接")
    segments = [s for s in parsed.path.split("/") if s]
    if len(segments) < 2:
        raise ValueError("无法从链接解析出文档类型和 token")
    seg, token = segments[0], segments[1]
    doc_type = _SEGMENT_TO_TYPE.get(seg)
    if doc_type is None:
        raise ValueError(f"暂不支持的飞书文档类型: {seg}")
    return doc_type, token
