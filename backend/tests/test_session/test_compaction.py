"""Compaction tests."""

from app.session.compaction import should_compact


class TestShouldCompact:
    def test_below_threshold(self):
        usage = {"input": 1000, "output": 500}
        assert not should_compact(usage, model_max_context=128_000)

    def test_above_threshold(self):
        usage = {"input": 120_000, "output": 5_000}
        assert should_compact(usage, model_max_context=128_000, reserved=20_000)

    def test_exactly_at_threshold(self):
        usage = {"input": 99_807, "output": 0}
        # usable = 128000 - 8192(effective_output) - 20000(reserved) = 99808
        assert not should_compact(usage, model_max_context=128_000, reserved=20_000)

    def test_just_over_threshold(self):
        usage = {"input": 108_001, "output": 0}
        assert should_compact(usage, model_max_context=128_000, reserved=20_000)

    def test_empty_usage(self):
        assert not should_compact({}, model_max_context=128_000)

    def test_small_model(self):
        usage = {"input": 3500, "output": 500}
        assert should_compact(usage, model_max_context=4096, model_max_output=512, reserved=500)

    def test_uses_reported_total_when_present(self):
        usage = {
            "input": 10,
            "output": 10,
            "reasoning": 10,
            "cache_read": 10,
            "total": 108_001,
        }
        assert should_compact(usage, model_max_context=128_000, reserved=20_000)

    def test_includes_reasoning_and_cache_read_in_fallback_total(self):
        usage = {
            "input": 107_900,
            "output": 0,
            "reasoning": 50,
            "cache_read": 100,
        }
        assert should_compact(usage, model_max_context=128_000, reserved=20_000)


class TestShouldCompactDefaultBuffer:
    """New default trigger: window − min(nominal_output, 8K) − clamp(window×10%, 8K, 33K).

    Aligns with OpenCode (context − output reservation) and Claude Code
    (~33K reserved buffer), replacing the old min(20K, output) reserve that
    permanently disabled the trigger for large-output models.
    """

    def test_large_nominal_output_no_longer_kills_trigger(self):
        # Old bug: reserving the nominal 64K output made usable ≤ 0 for a
        # 128K window, so proactive compaction never fired. Now the
        # reservation is capped at hard_max_output_tokens (8K):
        # usable = 200_000 − 8_192 − 20_000 = 171_808 (~86% of window)
        assert should_compact(
            {"total": 175_000}, model_max_context=200_000, model_max_output=65_536
        )
        assert not should_compact(
            {"total": 170_000}, model_max_context=200_000, model_max_output=65_536
        )

    def test_trigger_point_for_128k_window(self):
        # usable = 128_000 − 8_192 − 12_800 = 107_008 (~84% of window)
        assert not should_compact({"total": 107_007}, model_max_context=128_000)
        assert should_compact({"total": 107_008}, model_max_context=128_000)

    def test_buffer_floor_for_small_window(self):
        # 32_768 × 10% = 3_276 → clamped up to the 8_192 floor:
        # usable = 32_768 − 8_192 − 8_192 = 16_384
        assert not should_compact({"total": 16_383}, model_max_context=32_768)
        assert should_compact({"total": 16_384}, model_max_context=32_768)

    def test_buffer_ceiling_for_huge_window(self):
        # 1M × 10% = 100_000 → clamped down to the 33_000 ceiling:
        # usable = 1_000_000 − 8_192 − 33_000 = 958_808 (~96% of window)
        assert not should_compact({"total": 958_807}, model_max_context=1_000_000)
        assert should_compact({"total": 958_808}, model_max_context=1_000_000)

    def test_zero_or_negative_context_never_triggers(self):
        assert not should_compact({"total": 10_000}, model_max_context=0)
        assert not should_compact({"total": 10_000}, model_max_context=-1)

    def test_explicit_reserved_still_honored(self):
        # usable = 128_000 − 8_192 − 20_000 = 99_808
        assert should_compact(
            {"total": 100_000}, model_max_context=128_000, reserved=20_000
        )
