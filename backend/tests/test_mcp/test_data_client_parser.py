"""Tests for app.mcp.data_client_parser — data client result → metadata."""

from __future__ import annotations

import json

from app.mcp.data_client_parser import MAX_ROWS, parse_data_client_result


def test_execute_sql_sync():
    raw = json.dumps({
        "mode": "sync",
        "data": [[1, "hello"], [2, "world"]],
        "columns": ["n", "greeting"],
        "row_count": 2,
        "truncated": False,
        "duration_ms": 98,
    })
    md = parse_data_client_result("DataClient_execute_sql", {"sql": "SELECT 1"}, raw)
    assert md["codata_kind"] == "sql_result"
    assert md["sql"] == "SELECT 1"
    assert md["columns"] == [{"name": "n"}, {"name": "greeting"}]
    assert md["rows"] == [[1, "hello"], [2, "world"]]
    assert md["row_count"] == 2
    assert md["truncated"] is False
    assert md["visibility"] == "evidence"
    assert md["result_role"] == "query"


def test_execute_sql_row_cap():
    rows = [[i] for i in range(MAX_ROWS + 50)]
    raw = json.dumps({"mode": "sync", "columns": ["n"], "data": rows, "row_count": MAX_ROWS + 50})
    md = parse_data_client_result("DataClient_execute_sql", {}, raw)
    assert len(md["rows"]) == MAX_ROWS
    assert md["truncated"] is True
    assert md["row_count"] == MAX_ROWS + 50


def test_execute_sql_async():
    raw = json.dumps({"mode": "async", "job_id": "abc", "estimated_seconds": 12})
    md = parse_data_client_result("DataClient_execute_sql", {"sql": "SELECT big"}, raw)
    assert md["codata_kind"] == "sql_job"
    assert md["job_id"] == "abc"
    assert md["sql"] == "SELECT big"
    assert md["visibility"] == "evidence"


def test_job_status_running():
    raw = json.dumps({"status": "running", "job_id": "job-1", "estimated_seconds": 8})
    md = parse_data_client_result("DataClient_get_job_status", {}, raw)
    assert md["codata_kind"] == "sql_job"
    assert md["job_id"] == "job-1"
    assert md["status"] == "running"


def test_job_status_finished_becomes_result():
    raw = json.dumps({
        "status": "success",
        "job_id": "job-1",
        "columns": ["n"],
        "data": [[1], [2]],
        "row_count": 2,
    })
    md = parse_data_client_result("DataClient_get_job_status", {}, raw)
    assert md["codata_kind"] == "sql_result"
    assert md["rows"] == [[1], [2]]
    assert md["row_count"] == 2


def test_search_indicators():
    raw = json.dumps({
        "results": [
            {"code": "session_dau", "name": "会话日活", "unit": "人",
             "calculation_rule": "SELECT MAX(session_dau) ...", "description": "d"},
        ],
        "total": 1,
    })
    md = parse_data_client_result("DataClient_search_indicators", {}, raw)
    assert md["codata_kind"] == "indicator"
    assert md["indicators"][0]["code"] == "session_dau"
    assert md["indicators"][0]["sql"].startswith("SELECT MAX")
    assert md["total"] == 1
    assert md["visibility"] == "trace"
    assert md["result_role"] == "semantic-match"


def test_data_client_admin_query_indicator_rows_becomes_sql_result():
    raw = json.dumps({
        "ok": True,
        "rows": [
            {"business_unit": "企业服务", "total_revenue": "123.45"},
            {"business_unit": "消费业务", "total_revenue": "67.89"},
        ],
        "row_count": 2,
        "executed_sql": (
            "SELECT business_unit, SUM(revenue) AS total_revenue "
            "FROM finance_demo_pnl_monthly GROUP BY business_unit"
        ),
        "caliber": {
            "indicator": "total_revenue",
            "name": "营业收入",
            "unit": "元",
            "definition": "按财务月确认的实际营业收入",
            "data_layer": "DWS",
        },
    }, ensure_ascii=False)

    md = parse_data_client_result("data_client_admin_query_indicator", {}, raw)

    assert md["codata_kind"] == "sql_result"
    assert md["sql"].startswith("SELECT business_unit")
    assert md["columns"] == [{"name": "business_unit"}, {"name": "total_revenue"}]
    assert md["rows"] == [["企业服务", "123.45"], ["消费业务", "67.89"]]
    assert md["row_count"] == 2
    assert md["truncated"] is False
    # query_indicator carries caliber metadata — verify passthrough
    assert md["caliber"] is not None
    assert md["caliber"]["indicator"] == "total_revenue"
    assert md["caliber"]["name"] == "营业收入"
    assert md["caliber"]["unit"] == "元"


def test_execute_sql_has_no_caliber():
    """execute_sql results carry no caliber — it should be None in metadata."""
    raw = json.dumps({
        "mode": "sync",
        "data": [[1, "hello"], [2, "world"]],
        "columns": ["n", "greeting"],
        "row_count": 2,
        "truncated": False,
        "duration_ms": 45,
    })
    md = parse_data_client_result("DataClient_execute_sql", {"sql": "SELECT 1"}, raw)
    # No caliber payload → metadata.caliber is None
    assert md["caliber"] is None


def test_data_client_admin_search_semantic_renders_no_indicator_card():
    """方案 A：search_semantic 是"定位是哪个指标"的检索中间步，不出指标卡。

    它与随后的 get_model_context 讲同一个指标（前者候选+分数、后者权威口径），
    两者都出卡会让一次分析冒出两张几乎重复的"指标匹配"卡。现在只有
    get_model_context 出一张权威口径卡；search_semantic 返回 None（退回普通活动条），
    其完整文本仍在 tool output 里交给 agent。
    """
    raw = json.dumps({
        "ok": True,
        "items": [
            {
                "type": "indicator",
                "code": "total_revenue",
                "name": "营业收入",
                "unit": "元",
                "score": 0.97,
                "match": "exact",
            },
            {
                "type": "dimension",
                "code": "business_unit",
                "name": "业务单元",
            },
        ],
        "total": 2,
    }, ensure_ascii=False)

    md = parse_data_client_result("data_client_admin_search_semantic", {}, raw)

    assert md is None


def test_data_client_admin_get_model_context_indicators_become_rich_indicator_list():
    raw = json.dumps({
        "ok": True,
        "model": {"code": "demo_finance_analysis", "version": 1},
        "indicators": [
            {
                "code": "total_revenue",
                "name": "营业收入",
                "indicator_type": "atomic",
                "primary_entity": "finance_pnl_monthly",
                "unit": "元",
                "additivity": "additive",
                "description": "按财务月确认的实际营业收入。",
                "business_definition": "按财务月确认的实际营业收入。口径版本: DEMO_FIN_V1; 单位: 元。",
                "impls": [
                    {
                        "role": "primary",
                        "sql_text": "SELECT SUM(revenue) AS total_revenue FROM finance_demo_pnl_monthly",
                        "label": "DEMO_FIN 主口径",
                        "data_layer": "DWS",
                        "granularity": "month_bu_region",
                    }
                ],
                "available_dimensions": ["fiscal_month", "business_unit"],
            }
        ],
    }, ensure_ascii=False)

    md = parse_data_client_result("data_client_admin_get_model_context", {}, raw)

    assert md["codata_kind"] == "indicator"
    assert md["source"] == "model_context"
    assert md["visibility"] == "trace"
    assert md["result_role"] == "metric-context"
    assert md["model"] == {"code": "demo_finance_analysis", "version": 1}
    assert md["indicators"] == [
        {
            "code": "total_revenue",
            "name": "营业收入",
            "unit": "元",
            "sql": "SELECT SUM(revenue) AS total_revenue FROM finance_demo_pnl_monthly",
            "description": "按财务月确认的实际营业收入。口径版本: DEMO_FIN_V1; 单位: 元。",
            "indicator_type": "atomic",
            "primary_entity": "finance_pnl_monthly",
            "additivity": "additive",
            "data_layer": "DWS",
            "granularity": "month_bu_region",
            "impl_label": "DEMO_FIN 主口径",
            "available_dimensions": ["fiscal_month", "business_unit"],
        }
    ]
    assert md["total"] == 1


def test_unknown_tool_returns_none():
    raw = json.dumps({"mode": "sync", "columns": ["n"], "data": [[1]]})
    assert parse_data_client_result("DataClient_list_tables", {}, raw) is None


def test_non_json_returns_none():
    assert parse_data_client_result("DataClient_execute_sql", {}, "some error text") is None
    assert parse_data_client_result("DataClient_execute_sql", {}, "") is None


def test_matches_regardless_of_server_name():
    """The parser keys off the tool-name suffix, not a hardcoded server name."""
    raw = json.dumps({"mode": "sync", "columns": ["n"], "data": [[1]], "row_count": 1})
    for tool_id in (
        "execute_sql",             # no server prefix
        "data_client_execute_sql",    # lowercase server
        "DataSage_execute_sql",    # mixed case
        "my_data_platform_execute_sql",  # arbitrary multi-underscore server
        "___execute_sql",          # sanitised non-ascii server name (e.g. 数据平台)
    ):
        md = parse_data_client_result(tool_id, {}, raw)
        assert md is not None, tool_id
        assert md["codata_kind"] == "sql_result"


def test_suffix_collision_is_not_matched():
    """A tool merely ending in the same word but not on an underscore boundary."""
    raw = json.dumps({"mode": "sync", "columns": ["n"], "data": [[1]]})
    # 'preexecute_sql' would be a different tool; 'executesql' has no boundary.
    assert parse_data_client_result("Server_executesql", {}, raw) is None
