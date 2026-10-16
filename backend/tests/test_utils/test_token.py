"""Tests for app.utils.token — token counting utilities."""

from __future__ import annotations

import pytest

from app.utils.token import count_tokens, estimate_tokens


class TestCountTokens:
    @pytest.mark.skipif(True, reason="tiktoken needs network to download encoding data")
    def test_empty_string_returns_zero(self):
        assert count_tokens("") == 0

    @pytest.mark.skipif(True, reason="tiktoken needs network to download encoding data")
    def test_known_text(self):
        result = count_tokens("hello world")
        assert isinstance(result, int)
        assert result > 0

    @pytest.mark.skipif(True, reason="tiktoken needs network to download encoding data")
    def test_unicode_text(self):
        # CJK characters should not crash
        result = count_tokens("你好世界")
        assert result > 0

    @pytest.mark.skipif(True, reason="tiktoken needs network to download encoding data")
    def test_long_text(self):
        result = count_tokens("a " * 500)
        assert result > 0


class TestEstimateTokens:
    def test_empty_string_returns_one(self):
        assert estimate_tokens("") == 1

    def test_short_string(self):
        assert estimate_tokens("abc") == 1  # 3 // 4 = 0, clamped to 1

    def test_proportional(self):
        assert estimate_tokens("a" * 100) == 25

    def test_cjk_counts_one_token_per_char(self):
        # CJK characters average ~1 token each in cl100k_base — the old flat
        # len // 4 under-counted Chinese text by 4x.
        assert estimate_tokens("中" * 400) == 400

    def test_mixed_cjk_and_latin(self):
        # 100 CJK chars (100 tokens) + 300 Latin chars (300 // 4 = 75 tokens)
        assert estimate_tokens("abc中" * 100) == 175

    def test_japanese_and_korean_counted_as_cjk(self):
        assert estimate_tokens("あ" * 50) == 50
        assert estimate_tokens("한" * 50) == 50

    def test_fullwidth_punctuation_counted_as_cjk(self):
        assert estimate_tokens("，" * 10) == 10
