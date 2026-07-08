"""Tests for the structured report renderer."""

from __future__ import annotations

import json
import re

from app.report.renderer import render_report


def _full_spec() -> dict:
    return {
        "title": "商业化数据报告 近30天",
        "subtitle": "面向管理层",
        "meta": {"data_as_of": "2026-07-06", "generated_at": "2026-07-07", "source": "ads_xmp"},
        "summary": ["大盘稳中略降", "ARPPU +12.8%"],
        "kpis": [
            {"name": "总消耗", "value": "165.9万", "delta_pct": -2.2, "delta_dir": "down"},
            {"name": "ROI", "value": "0.79", "delta_pct": 0.3, "delta_dir": "up"},
        ],
        "charts": [
            {"type": "line", "title": "收入趋势", "x": ["06-07", "06-08"], "series": [{"name": "收入", "data": [4558, 4036]}]},
            {"type": "pie", "title": "收入构成", "series": [{"name": "订阅", "value": 7.36}, {"name": "IAA", "value": 5.41}]},
        ],
        "table": {"columns": ["日期", "收入"], "numeric": [False, True], "rows": [["06-07", 4558]], "note": "示例"},
        "insights": [
            {"kind": "fact", "text": "收入 -1.9%"},
            {"kind": "inference", "text": "订阅下滑"},
            {"kind": "recommendation", "text": "排查转化"},
        ],
        "caliber": [
            {"metric": "ROI", "desc": "收入/消耗"},
            {"metric": "合并指标", "desc": "多表 join", "custom": True},
        ],
        "caveats": ["06-12 缺口"],
    }


def test_renders_all_sections():
    h = render_report(_full_spec())
    assert h.startswith("<!DOCTYPE")
    assert "echarts@5.4.3" in h
    assert "执行摘要" in h
    assert "kpi-card" in h
    assert 'id="chart-0"' in h and 'id="chart-1"' in h
    assert "数据明细" in h
    assert "事实" in h and "推断" in h and "建议" in h
    assert "自定义口径" in h
    assert "数据截至 2026-07-06" in h


def test_chart_options_are_valid_json():
    h = render_report(_full_spec())
    calls = re.findall(r"\.setOption\((.*?)\);", h)
    assert len(calls) == 2
    for arg in calls:
        opt = json.loads(arg)
        assert opt["backgroundColor"] == "transparent"


def test_no_charts_omits_cdn_and_script():
    h = render_report({"title": "纯文字报告", "summary": ["无图"]})
    assert "echarts" not in h
    assert ".setOption(" not in h
    assert "执行摘要" in h


def test_escapes_untrusted_text():
    h = render_report({"title": "<script>alert(1)</script>", "summary": ["<b>x</b>"]})
    assert "<script>alert(1)</script>" not in h
    assert "&lt;script&gt;" in h


def test_delta_direction_classes():
    h = render_report({"title": "t", "kpis": [
        {"name": "a", "value": "1", "delta_pct": 5, "delta_dir": "up"},
        {"name": "b", "value": "2", "delta_pct": -3, "delta_dir": "down"},
    ]})
    assert "kpi-delta up" in h
    assert "kpi-delta down" in h
