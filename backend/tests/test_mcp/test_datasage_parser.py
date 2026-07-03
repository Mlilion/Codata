"""Tests for app.mcp.datasage_parser — datasage result → metadata."""

from __future__ import annotations

import json

from app.mcp.datasage_parser import MAX_ROWS, parse_datasage_result


def test_execute_sql_sync():
    raw = json.dumps({
        "mode": "sync",
        "data": [[1, "hello"], [2, "world"]],
        "columns": ["n", "greeting"],
        "row_count": 2,
        "truncated": False,
        "duration_ms": 98,
    })
    md = parse_datasage_result("Datasage_execute_sql", {"sql": "SELECT 1"}, raw)
    assert md["codata_kind"] == "sql_result"
    assert md["sql"] == "SELECT 1"
    assert md["columns"] == [{"name": "n"}, {"name": "greeting"}]
    assert md["rows"] == [[1, "hello"], [2, "world"]]
    assert md["row_count"] == 2
    assert md["truncated"] is False


def test_execute_sql_row_cap():
    rows = [[i] for i in range(MAX_ROWS + 50)]
    raw = json.dumps({"mode": "sync", "columns": ["n"], "data": rows, "row_count": MAX_ROWS + 50})
    md = parse_datasage_result("Datasage_execute_sql", {}, raw)
    assert len(md["rows"]) == MAX_ROWS
    assert md["truncated"] is True
    assert md["row_count"] == MAX_ROWS + 50


def test_execute_sql_async():
    raw = json.dumps({"mode": "async", "job_id": "abc", "estimated_seconds": 12})
    md = parse_datasage_result("Datasage_execute_sql", {"sql": "SELECT big"}, raw)
    assert md["codata_kind"] == "sql_job"
    assert md["job_id"] == "abc"
    assert md["sql"] == "SELECT big"


def test_search_indicators():
    raw = json.dumps({
        "results": [
            {"code": "session_dau", "name": "会话日活", "unit": "人",
             "calculation_rule": "SELECT MAX(session_dau) ...", "description": "d"},
        ],
        "total": 1,
    })
    md = parse_datasage_result("Datasage_search_indicators", {}, raw)
    assert md["codata_kind"] == "indicator"
    assert md["indicators"][0]["code"] == "session_dau"
    assert md["indicators"][0]["sql"].startswith("SELECT MAX")
    assert md["total"] == 1


def test_unknown_tool_returns_none():
    raw = json.dumps({"mode": "sync", "columns": ["n"], "data": [[1]]})
    assert parse_datasage_result("Datasage_list_tables", {}, raw) is None


def test_non_json_returns_none():
    assert parse_datasage_result("Datasage_execute_sql", {}, "some error text") is None
    assert parse_datasage_result("Datasage_execute_sql", {}, "") is None


def test_matches_regardless_of_server_name():
    """The parser keys off the tool-name suffix, not a hardcoded server name."""
    raw = json.dumps({"mode": "sync", "columns": ["n"], "data": [[1]], "row_count": 1})
    for tool_id in (
        "execute_sql",             # no server prefix
        "datasage_execute_sql",    # lowercase server
        "DataSage_execute_sql",    # mixed case
        "my_data_platform_execute_sql",  # arbitrary multi-underscore server
        "___execute_sql",          # sanitised non-ascii server name (e.g. 数据平台)
    ):
        md = parse_datasage_result(tool_id, {}, raw)
        assert md is not None, tool_id
        assert md["codata_kind"] == "sql_result"


def test_suffix_collision_is_not_matched():
    """A tool merely ending in the same word but not on an underscore boundary."""
    raw = json.dumps({"mode": "sync", "columns": ["n"], "data": [[1]]})
    # 'preexecute_sql' would be a different tool; 'executesql' has no boundary.
    assert parse_datasage_result("Server_executesql", {}, raw) is None
