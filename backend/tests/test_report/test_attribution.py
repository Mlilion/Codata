from __future__ import annotations

import pytest

from app.report.attribution import compile_attribution_spec


def test_compiles_numeric_driver_contributions_and_ranks():
    result = compile_attribution_spec({
        "report_type": "attribution",
        "attribution": {"baseline_raw": 100, "current_raw": 150, "causal_claim": False},
        "drivers": [
            {"name": "上海", "delta_raw": 10},
            {"name": "北京", "baseline_raw": 20, "current_raw": 60},
        ],
    })

    assert result["attribution"]["delta_raw"] == 50
    assert result["attribution"]["delta_pct"] == 50
    assert result["attribution"]["explained_pct"] == 100
    assert [driver["name"] for driver in result["drivers"]] == ["北京", "上海"]
    assert result["drivers"][0]["contribution_pct"] == 80
    assert result["drivers"][1]["contribution_pct"] == 20
    assert result["drivers"][0]["rank"] == 1
    assert "贡献度表示统计分解" in result["caveats"][0]
    assert result["delivery"]["report_recommended"] is False


def test_recommends_report_for_complex_attribution():
    result = compile_attribution_spec({
        "report_type": "attribution",
        "analysis_type": "change_attribution",
        "attribution": {"delta_raw": 100},
        "drivers": [
            {"name": "北京", "dimension": "省份", "delta_raw": 80},
            {"name": "上海", "dimension": "省份", "delta_raw": 35},
            {"name": "其他", "dimension": "省份", "delta_raw": -15},
        ],
        "evidence": [
            {"evidence_id": "ev_1", "kind": "period_total"},
            {"evidence_id": "ev_2", "kind": "dimension_breakdown"},
        ],
    })
    delivery = result["delivery"]
    assert delivery["report_recommended"] is True
    assert delivery["report_level"] == "full"
    assert any("3 个驱动因素" in reason for reason in delivery["reasons"])
    assert any("正向和负向" in reason for reason in delivery["reasons"])


def test_does_not_recommend_report_for_simple_attribution():
    result = compile_attribution_spec({
        "report_type": "attribution",
        "attribution": {"delta_raw": 10},
        "drivers": [{"name": "北京", "delta_raw": 10}],
    })
    assert result["delivery"] == {
        "report_recommended": False,
        "report_level": "none",
        "reasons": [],
    }


def test_validates_evidence_references():
    result = compile_attribution_spec({
        "report_type": "attribution",
        "evidence": [{"evidence_id": "ev_1", "metric": "订单金额"}],
        "insights": [{"kind": "fact", "text": "北京贡献最大", "evidence_ids": ["ev_1"]}],
    })
    assert result["evidence"][0]["evidence_id"] == "ev_1"

    with pytest.raises(ValueError, match="Unknown attribution evidence"):
        compile_attribution_spec({
            "report_type": "attribution",
            "evidence": [{"evidence_id": "ev_1"}],
            "drivers": [{"name": "北京", "evidence_ids": ["ev_missing"]}],
        })


def test_general_report_is_unchanged():
    spec = {"title": "普通报告", "summary": ["结论"]}
    assert compile_attribution_spec(spec) == spec
