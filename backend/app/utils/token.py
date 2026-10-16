"""Token counting utilities."""

from __future__ import annotations

import re

import tiktoken

_encoding: tiktoken.Encoding | None = None

# CJK (and kana/hangul/fullwidth) characters average ~1 token each in
# cl100k_base, while Latin text averages ~4 chars per token. Counting them
# separately keeps the fast estimate from under-counting Chinese/Japanese/
# Korean content by 3-4x.
_CJK_CHAR_RE = re.compile(
    "["
    "　-〿"  # CJK symbols and punctuation
    "぀-ヿ"  # hiragana + katakana
    "㐀-䶿"  # CJK unified ideographs extension A
    "一-鿿"  # CJK unified ideographs
    "가-힯"  # hangul syllables
    "豈-﫿"  # CJK compatibility ideographs
    "＀-￯"  # halfwidth and fullwidth forms
    "]"
)


def _get_encoding() -> tiktoken.Encoding:
    global _encoding
    if _encoding is None:
        _encoding = tiktoken.get_encoding("cl100k_base")
    return _encoding


def count_tokens(text: str) -> int:
    """Count tokens using cl100k_base encoding (reasonable approximation for most models)."""
    return len(_get_encoding().encode(text))


def estimate_tokens(text: str) -> int:
    """Fast token estimate without full encoding.

    Latin text: ~4 chars per token. CJK characters: ~1 token each. Mixing
    both keeps the estimate honest for Chinese-heavy conversations (the old
    flat ``len // 4`` under-counted them by 3-4x, which skewed every
    microcompact/collapse/prune budget decision).
    """
    if not text:
        return 1
    cjk = len(_CJK_CHAR_RE.findall(text))
    return max(1, cjk + (len(text) - cjk) // 4)
