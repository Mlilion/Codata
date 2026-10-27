"""Data Client MCP result parser.

Turns the raw text output of a few key data client tools into structured
``metadata`` so the frontend can render SQL / result tables / charts instead
of a raw ``<pre>`` blob.

The metadata rides on ``ToolResult.metadata`` (already streamed to the
frontend as ``ToolPart.state.metadata``). We namespace every payload under the
``codata_kind`` key to avoid colliding with the existing artifact ``type``
convention (which triggers artifact file persistence in the session
processor).

Confirmed real response shapes (July 2026):
  execute_sql  sync  → {"mode":"sync","data":[[...]],"columns":["n",...],
                        "row_count":2,"truncated":false,"duration_ms":98}
  execute_sql  async → {"mode":"async","job_id":"...","estimated_seconds":N}
  execute_sql  export→ {"job_id":"<uuid>", ...}  (format=csv/parquet/json)
  get_job_status     → running: {"status":"running","job_id":"..."}
                       done:    {"status":"success","columns":[...],"data":[...]}
  search_indicators  → {"results":[{"code","name","calculation_rule",...}],
                        "total":N}
  query_indicator    → {"ok":true,"rows":[{"metric":123}],
                        "executed_sql":"SELECT ..."}
  search_semantic    → {"ok":true,"items":[{"type":"indicator","code",...}]}
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Tool IDs are ``{sanitised_server_name}_{sanitised_tool_name}``. We match on
# the *tool-name* suffix rather than a hardcoded server name, so this works
# regardless of what the user named their data client MCP server ("DataClient",
# "data_client", "DataPlatform", "数据平台", …). The bare tool names below never
# contain characters that ``sanitise_name`` would rewrite, so the suffix is
# stable.
EXECUTE_SQL = "execute_sql"
SEARCH_INDICATORS = "search_indicators"
COMPILE_METRIC_SQL = "compile_metric_sql"
GET_JOB_STATUS = "get_job_status"
QUERY_INDICATOR = "query_indicator"
SEARCH_SEMANTIC = "search_semantic"
GET_MODEL_CONTEXT = "get_model_context"

KNOWN_TOOLS = frozenset(
    {
        EXECUTE_SQL,
        SEARCH_INDICATORS,
        COMPILE_METRIC_SQL,
        GET_JOB_STATUS,
        QUERY_INDICATOR,
        SEARCH_SEMANTIC,
        GET_MODEL_CONTEXT,
    }
)


def _match_tool(tool_id: str) -> str | None:
    """Return the known data client tool name a ``tool_id`` refers to, or None.

    ``tool_id`` is ``{server}_{tool}``; we accept an exact tool-name match or a
    ``_{tool}`` suffix so any server name works.
    """
    for name in KNOWN_TOOLS:
        if tool_id == name or tool_id.endswith(f"_{name}"):
            return name
    return None

# Cap rows shipped to the frontend; the full result stays in output text.
MAX_ROWS = 500


def parse_data_client_result(
    tool_id: str,
    args: dict[str, Any],
    raw_text: str,
) -> dict[str, Any] | None:
    """Parse a data client tool result into structured metadata.

    Returns a dict to merge into ``ToolResult.metadata``, or ``None`` when the
    output isn't recognised (caller leaves metadata untouched).
    """
    tool = _match_tool(tool_id)
    if tool is None:
        return None

    payload = _safe_json(raw_text)
    if payload is None:
        return None

    try:
        if tool == EXECUTE_SQL:
            return _parse_execute_sql(args, payload)
        if tool == QUERY_INDICATOR:
            return _parse_query_indicator(args, payload)
        if tool == SEARCH_SEMANTIC:
            return _parse_search_semantic(payload)
        if tool == GET_MODEL_CONTEXT:
            return _parse_model_context(payload)
        if tool == GET_JOB_STATUS:
            return _parse_job_status(payload)
        if tool in (SEARCH_INDICATORS, COMPILE_METRIC_SQL):
            return _parse_indicators(payload)
    except Exception:  # defensive: never break the tool result over parsing
        logger.debug("data_client parse failed for %s", tool_id, exc_info=True)
    return None


def _safe_json(raw_text: str) -> Any | None:
    text = (raw_text or "").strip()
    if not text or text[0] not in "{[":
        return None
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def _parse_execute_sql(
    args: dict[str, Any],
    payload: Any,
) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    sql = _sql_from_args_or_payload(args, payload)

    mode = payload.get("mode")

    # Async job — hand polling to the agent via get_job_status.
    if mode == "async" or (payload.get("job_id") and "columns" not in payload):
        return {
            "codata_kind": "sql_job",
            "visibility": "evidence",
            "result_role": "query",
            "job_id": str(payload.get("job_id", "")),
            "status": str(payload.get("status", "pending")),
            "estimated_seconds": payload.get("estimated_seconds"),
            "sql": sql or None,
        }

    # Sync result with columns + rows.
    result = _sql_result_from_payload(payload, sql, _sql_from_args(args))
    if result is not None:
        return result

    return None


def _sql_result_from_payload(
    payload: dict[str, Any],
    sql: str | None,
    requested_sql: str | None = None,
) -> dict[str, Any] | None:
    """Build a ``sql_result`` metadata dict from a known row payload shape."""
    raw_columns = payload.get("columns")
    raw_rows = payload.get("data")
    if isinstance(raw_columns, list) and isinstance(raw_rows, list):
        columns = [
            {"name": str(c)} if not isinstance(c, dict) else c
            for c in raw_columns
        ]
        rows = raw_rows[:MAX_ROWS]
        return _sql_result_metadata(payload, sql, columns, rows, len(raw_rows), requested_sql)

    dict_rows = payload.get("rows")
    if isinstance(dict_rows, list):
        return _sql_result_from_dict_rows(payload, sql, dict_rows, requested_sql)

    return None


def _sql_result_from_dict_rows(
    payload: dict[str, Any],
    sql: str | None,
    raw_rows: list[Any],
    requested_sql: str | None = None,
) -> dict[str, Any] | None:
    column_names: list[str] = []
    seen: set[str] = set()
    for row in raw_rows:
        if not isinstance(row, dict):
            return None
        for key in row:
            name = str(key)
            if name not in seen:
                seen.add(name)
                column_names.append(name)

    columns = [{"name": name} for name in column_names]
    rows = [
        [_cell_value(row.get(name)) for name in column_names]
        for row in raw_rows[:MAX_ROWS]
        if isinstance(row, dict)
    ]
    return _sql_result_metadata(payload, sql, columns, rows, len(raw_rows), requested_sql)


def _sql_result_metadata(
    payload: dict[str, Any],
    sql: str | None,
    columns: list[Any],
    rows: list[Any],
    raw_row_count: int,
    requested_sql: str | None = None,
) -> dict[str, Any]:
    row_count = _int_or_default(payload.get("row_count"), raw_row_count)
    truncated = bool(payload.get("truncated")) or raw_row_count > MAX_ROWS
    requested_sql = requested_sql or payload.get("requested_sql") or payload.get("sql") or sql
    result = {
        "codata_kind": "sql_result",
        "visibility": "evidence",
        "result_role": "query",
        "sql": sql or None,
        "requested_sql": requested_sql or (sql or None),
        "columns": columns,
        "rows": rows,
        "row_count": row_count,
        "truncated": truncated,
        "duration_ms": payload.get("duration_ms"),
        "caliber": payload.get("caliber"),  # query_indicator 有, execute_sql 无 → None
    }
    for key in ("knowledge", "top_n_applied", "total_groups", "dialect", "mode"):
        if payload.get(key) is not None:
            result[key] = payload[key]
    return result


def _parse_query_indicator(
    args: dict[str, Any],
    payload: Any,
) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    return _sql_result_from_payload(
        payload,
        _sql_from_args_or_payload(args, payload),
        _sql_from_args(args),
    )


def _parse_job_status(payload: Any) -> dict[str, Any] | None:
    """Parse a get_job_status result.

    When the async job has finished and the payload carries columns+data, emit
    a ``sql_result`` so the finished query renders as a table/chart. Otherwise
    surface the job's running/pending/failed state as a ``sql_job`` card. The
    SQL text isn't in this response, so it stays absent here.
    """
    if not isinstance(payload, dict):
        return None

    result = _sql_result_from_payload(payload, None)
    if result is not None:
        return result

    status = str(payload.get("status", "")).lower()
    job_id = str(payload.get("job_id", ""))
    # Only emit a job card when we actually have a job to talk about.
    if not job_id and not status:
        return None
    return {
        "codata_kind": "sql_job",
        "job_id": job_id,
        "status": status or "pending",
        "estimated_seconds": payload.get("estimated_seconds"),
        "sql": None,
    }


def _parse_indicators(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    results = payload.get("results")
    if not isinstance(results, list) or not results:
        return None

    indicators = []
    for item in results:
        if not isinstance(item, dict):
            continue
        indicators.append(_indicator_metadata(item))

    return {
        "codata_kind": "indicator",
        "visibility": "trace",
        "result_role": "semantic-match",
        "indicators": indicators,
        "total": payload.get("total", len(indicators)),
    }


def _parse_search_semantic(payload: Any) -> dict[str, Any] | None:
    """search_semantic 是"定位是哪个指标"的检索中间步 —— 不渲染指标卡。

    它与后续的 get_model_context 讲的是同一个指标（前者给候选+相关性分数，后者给
    权威口径），两者都出卡会让一次分析冒出两张几乎重复的"指标匹配"卡。方案 A：
    只让 get_model_context 出一张权威口径卡，search_semantic 退回普通活动条（其
    完整文本仍在 tool output 里交给 agent，不影响取数决策）。

    返回 None 即"无可渲染的结构化结果"，前端据此不为它出数据卡。
    """
    return None


def _parse_model_context(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    raw_indicators = payload.get("indicators")
    if not isinstance(raw_indicators, list) or not raw_indicators:
        return None

    indicators = [
        _indicator_metadata(item)
        for item in raw_indicators
        if isinstance(item, dict)
    ]
    if not indicators:
        return None

    result: dict[str, Any] = {
        "codata_kind": "indicator",
        "source": "model_context",
        "visibility": "trace",
        "result_role": "metric-context",
        "indicators": indicators,
        "total": len(indicators),
    }
    if isinstance(payload.get("model"), dict):
        result["model"] = payload["model"]
    return result


def _indicator_metadata(
    item: dict[str, Any],
    *,
    fallback_description: str | None = None,
) -> dict[str, Any]:
    impl = _primary_indicator_impl(item)
    meta = {
        "code": item.get("code"),
        "name": item.get("name"),
        "unit": item.get("unit"),
        "sql": _indicator_sql(item, impl),
        "description": (
            item.get("business_definition")
            or item.get("description")
            or fallback_description
        ),
    }
    _copy_known_fields(
        meta,
        item,
        (
            "score",
            "match",
            "needs_clarify",
            "not_buildable",
            "indicator_type",
            "primary_entity",
            "additivity",
            "available_dimensions",
        ),
    )
    if impl:
        for source_key, target_key in (
            ("data_layer", "data_layer"),
            ("granularity", "granularity"),
            ("label", "impl_label"),
        ):
            value = impl.get(source_key)
            if value is not None:
                meta[target_key] = value
    return meta


def _indicator_sql(item: dict[str, Any], impl: dict[str, Any] | None) -> Any:
    for key in ("calculation_rule", "composite_formula", "sql", "sql_text"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value
    if impl:
        value = impl.get("sql_text") or impl.get("sql")
        if isinstance(value, str) and value.strip():
            return value
    return None


def _primary_indicator_impl(item: dict[str, Any]) -> dict[str, Any] | None:
    impls = item.get("impls")
    if not isinstance(impls, list):
        return None
    dict_impls = [impl for impl in impls if isinstance(impl, dict)]
    if not dict_impls:
        return None
    for impl in dict_impls:
        if impl.get("role") == "primary":
            return impl
    return dict_impls[0]


def _copy_known_fields(
    target: dict[str, Any],
    source: dict[str, Any],
    keys: tuple[str, ...],
) -> None:
    for key in keys:
        value = source.get(key)
        if value is not None:
            target[key] = value


def _sql_from_args_or_payload(
    args: dict[str, Any],
    payload: dict[str, Any] | None = None,
) -> str:
    for source in (payload or {}, args):
        for key in ("executed_sql", "sql", "query", "statement"):
            val = source.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
    return ""


def _sql_from_args(args: dict[str, Any]) -> str:
    for key in ("sql", "query", "statement"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _cell_value(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float):
        return value
    return str(value)


def _int_or_default(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Generic tabular result normalisation
# ---------------------------------------------------------------------------
# Codata's own parser above only understands the data-client MCP's specific
# tools and JSON shapes. A directly-connected database MCP (Postgres, MySQL,
# Snowflake, ...) exposes different query tools and returns different shapes,
# so we add a best-effort normaliser that turns those into the same
# ``sql_result`` metadata the frontend already renders as a table/SQL/chart
# card. It is deliberately conservative: it only fires for query-like tools,
# so a list of Slack channels or GitHub issues is never turned into a card.

# Tool IDs are ``{sanitised_server}_{sanitised_tool}``. These are the tool-name
# suffixes we treat as "read query" tools. Kept explicit rather than fuzzy so
# unrelated tools (list_channels, create_issue, ...) are never carded.
_QUERY_TOOL_SUFFIXES = (
    "query",
    "read_query",
    "run_query",
    "execute_query",
    "run_sql",
    "execute_sql",
    "query_data",
    "sql",
    "select",
    "fetch",
)

_MARKDOWN_SEPARATOR_RE = re.compile(r"^:?-{1,}:?$")


def _looks_like_query_tool(tool_id: str) -> bool:
    """True when ``tool_id``'s tool-name suffix suggests a read query tool."""
    for suffix in _QUERY_TOOL_SUFFIXES:
        if tool_id == suffix or tool_id.endswith("_" + suffix):
            return True
    return False


def normalize_tabular_result(
    tool_id: str,
    args: dict[str, Any],
    raw_text: str,
) -> dict[str, Any] | None:
    """Normalise a foreign (non-Codata) query result into ``sql_result`` metadata.

    Returns a dict to merge into ``ToolResult.metadata``, or ``None`` when the
    tool isn't a query tool or the output isn't recognisably tabular. Handles:

      * ``{"columns": [...], "data"/"rows": [...]}`` (generic column+rows JSON)
      * ``[{"a": 1}, {"a": 2}]`` (list of dicts)
      * a Markdown / pipe-delimited table in the raw text

    ``sql`` is recovered from the call args so the card's SQL tab still shows
    the query the user's source ran.
    """
    if not _looks_like_query_tool(tool_id):
        return None

    sql = _sql_from_args(args)

    payload = _safe_json(raw_text)
    if isinstance(payload, dict):
        result = _sql_result_from_payload(payload, sql, sql)
        if result is not None:
            return result
    if isinstance(payload, list) and payload and all(isinstance(r, dict) for r in payload):
        result = _sql_result_from_dict_rows({}, sql, payload, sql)
        if result is not None:
            return result

    table = _parse_markdown_table(raw_text)
    if table is not None:
        columns, rows = table
        return _sql_result_metadata(
            {},
            sql,
            [{"name": c} for c in columns],
            rows[:MAX_ROWS],
            len(rows),
            sql,
        )

    return None


def _parse_markdown_table(text: str) -> tuple[list[str], list[list[str]]] | None:
    """Parse a Markdown / pipe-delimited table into (columns, rows) or None."""
    lines = (text or "").splitlines()
    table_rows: list[list[str]] = []
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        table_rows.append([c.strip() for c in stripped.strip("|").split("|")])

    if len(table_rows) < 2:
        return None

    header = table_rows[0]
    if not header or not any(header):
        return None

    data = table_rows[1:]
    # Drop the markdown separator row (| --- | --- |) right after the header.
    if data and any(data[0]) and all(
        cell == "" or _MARKDOWN_SEPARATOR_RE.match(cell) for cell in data[0]
    ):
        data = data[1:]
    if not data:
        return None

    width = len(header)
    rows = [(row + [""] * width)[:width] for row in data if any(row)]
    if not rows:
        return None
    return header, rows
