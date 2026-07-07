from pathlib import Path


def test_data_prompt_enforces_caliber_and_sanity_check():
    text = (Path(__file__).resolve().parents[2] / "app" / "agent" / "prompts" / "data.txt").read_text(encoding="utf-8")
    # 口径：核心指标必须先 search_indicators 权威口径
    assert "search_indicators" in text
    assert "自定义口径" in text  # 无注册指标时须注明
    # 数量级 sanity-check
    assert "数量级" in text or "sanity" in text.lower()
