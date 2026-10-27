"""Tests for the generic tabular result normaliser (foreign DB MCP tools)."""

import pytest

from app.mcp.data_client_parser import MAX_ROWS, normalize_tabular_result


def test_non_query_tool_returns_none():
    # A non-query tool's list-of-dicts output must NOT become a data card.
    assert normalize_tabular_result("slack_list_channels", {}, '[{"id": "c1"}]') is None


def test_list_of_dicts_becomes_sql_result():
    md = normalize_tabular_result(
        "postgres_query",
        {"query": "SELECT a FROM t"},
        '[{"a": 1}, {"a": 2}]',
    )
    assert md is not None
    assert md["codata_kind"] == "sql_result"
    assert md["columns"] == [{"name": "a"}]
    assert md["rows"] == [[1], [2]]
    assert md["row_count"] == 2
    assert md["sql"] == "SELECT a FROM t"
    assert md["truncated"] is False


def test_columns_rows_object_becomes_sql_result():
    md = normalize_tabular_result(
        "mysql_query",
        {"sql": "SELECT x, y FROM t"},
        '{"columns": ["x", "y"], "data": [[1, "a"], [2, "b"]]}',
    )
    assert md is not None
    assert md["codata_kind"] == "sql_result"
    assert md["columns"] == [{"name": "x"}, {"name": "y"}]
    assert md["rows"] == [[1, "a"], [2, "b"]]


def test_markdown_table_becomes_sql_result():
    text = "| name | value |\n|------|-------|\n| a    | 1     |\n| b    | 2     |"
    md = normalize_tabular_result("sqlite_read_query", {"query": "SELECT *"}, text)
    assert md is not None
    assert md["codata_kind"] == "sql_result"
    assert md["columns"] == [{"name": "name"}, {"name": "value"}]
    assert md["rows"] == [["a", "1"], ["b", "2"]]
    assert md["sql"] == "SELECT *"


def test_non_tabular_json_returns_none():
    assert normalize_tabular_result("postgres_query", {}, '{"status": "ok"}') is None


def test_bare_list_of_lists_is_not_normalized():
    # No column names to key off — too ambiguous to auto-chart.
    assert normalize_tabular_result("postgres_query", {}, "[[1, 2], [3, 4]]") is None


def test_row_cap():
    rows = [{"n": i} for i in range(MAX_ROWS + 1)]
    md = normalize_tabular_result("postgres_query", {}, str(rows).replace("'", '"'))
    assert md is not None
    assert md["truncated"] is True
    assert len(md["rows"]) == MAX_ROWS
    assert md["row_count"] == MAX_ROWS + 1


def test_sql_recovered_from_statement_arg():
    md = normalize_tabular_result("db_query", {"statement": "SELECT 1"}, '[{"x": 1}]')
    assert md["sql"] == "SELECT 1"


@pytest.mark.asyncio
async def test_wrapper_normalizes_query_tool_result():
    """End-to-end: a query-like MCP tool result flows into sql_result metadata."""
    pytest.importorskip("mcp")

    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.mcp.tool_wrapper import McpToolWrapper

    client = SimpleNamespace(
        name="postgres",
        tool_id=lambda name: f"postgres_{name}",
        call_tool=AsyncMock(return_value=SimpleNamespace(
            content=[SimpleNamespace(type="text", text='[{"a": 1}, {"a": 2}]')],
            isError=False,
        )),
    )
    tool = SimpleNamespace(
        name="query",
        description="Run a query",
        inputSchema={"type": "object", "properties": {"query": {"type": "string"}}},
    )
    wrapper = McpToolWrapper(client, tool)

    result = await wrapper.execute({"query": "SELECT 1"}, SimpleNamespace())

    assert result.error is None
    assert result.metadata.get("codata_kind") == "sql_result"
    assert result.metadata["columns"] == [{"name": "a"}]
    assert result.metadata["rows"] == [[1], [2]]
