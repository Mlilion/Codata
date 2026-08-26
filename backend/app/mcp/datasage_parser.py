"""Datasage MCP result parser.

Turns the raw text output of a few key datasage tools into structured
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
from typing import Any

logger = logging.getLogger(__name__)

# Tool IDs are ``{sanitised_server_name}_{sanitised_tool_name}``. We match on
# the *tool-name* suffix rather than a hardcoded server name, so this works
# regardless of what the user named their datasage MCP server ("Datasage",
# "datasage", "DataSage", "数据平台", …). The bare tool names below never
# contain characters that ``sanitise_name`` would rewrite, so the suffix is
# stable.
EXECUTE_SQL = "execute_sql"
SEARCH_INDICATORS = "search_indicators"
COMPILE_METRIC_SQL = "compile_metric_sql"
GET_JOB_STATUS = "get_job_status"
QUERY_INDICATOR = "query_indicator"
SEARCH_SEMANTIC = "search_semantic"

KNOWN_TOOLS = frozenset(
    {
        EXECUTE_SQL,
        SEARCH_INDICATORS,
        COMPILE_METRIC_SQL,
        GET_JOB_STATUS,
        QUERY_INDICATOR,
        SEARCH_SEMANTIC,
    }
)


def _match_tool(tool_id: str) -> str | None:
    """Return the known datasage tool name a ``tool_id`` refers to, or None.

    ``tool_id`` is ``{server}_{tool}``; we accept an exact tool-name match or a
    ``_{tool}`` suffix so any server name works.
    """
    for name in KNOWN_TOOLS:
        if tool_id == name or tool_id.endswith(f"_{name}"):
            return name
    return None

# Cap rows shipped to the frontend; the full result stays in output text.
MAX_ROWS = 500


def parse_datasage_result(
    tool_id: str,
    args: dict[str, Any],
    raw_text: str,
) -> dict[str, Any] | None:
    """Parse a datasage tool result into structured metadata.

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
        if tool == GET_JOB_STATUS:
            return _parse_job_status(payload)
        if tool in (SEARCH_INDICATORS, COMPILE_METRIC_SQL):
            return _parse_indicators(payload)
    except Exception:  # defensive: never break the tool result over parsing
        logger.debug("datasage parse failed for %s", tool_id, exc_info=True)
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
            "job_id": str(payload.get("job_id", "")),
            "status": str(payload.get("status", "pending")),
            "estimated_seconds": payload.get("estimated_seconds"),
            "sql": sql or None,
        }

    # Sync result with columns + rows.
    result = _sql_result_from_payload(payload, sql)
    if result is not None:
        return result

    return None


def _sql_result_from_payload(
    payload: dict[str, Any],
    sql: str | None,
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
        return _sql_result_metadata(payload, sql, columns, rows, len(raw_rows))

    dict_rows = payload.get("rows")
    if isinstance(dict_rows, list):
        return _sql_result_from_dict_rows(payload, sql, dict_rows)

    return None


def _sql_result_from_dict_rows(
    payload: dict[str, Any],
    sql: str | None,
    raw_rows: list[Any],
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
    return _sql_result_metadata(payload, sql, columns, rows, len(raw_rows))


def _sql_result_metadata(
    payload: dict[str, Any],
    sql: str | None,
    columns: list[Any],
    rows: list[Any],
    raw_row_count: int,
) -> dict[str, Any]:
    row_count = _int_or_default(payload.get("row_count"), raw_row_count)
    truncated = bool(payload.get("truncated")) or raw_row_count > MAX_ROWS
    return {
        "codata_kind": "sql_result",
        "sql": sql or None,
        "columns": columns,
        "rows": rows,
        "row_count": row_count,
        "truncated": truncated,
        "duration_ms": payload.get("duration_ms"),
    }


def _parse_query_indicator(
    args: dict[str, Any],
    payload: Any,
) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    return _sql_result_from_payload(payload, _sql_from_args_or_payload(args, payload))


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
        indicators.append(
            {
                "code": item.get("code"),
                "name": item.get("name"),
                "unit": item.get("unit"),
                "sql": item.get("calculation_rule") or item.get("composite_formula"),
                "description": item.get("description"),
            }
        )

    return {
        "codata_kind": "indicator",
        "indicators": indicators,
        "total": payload.get("total", len(indicators)),
    }


def _parse_search_semantic(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return None

    indicators = []
    for item in items:
        if not isinstance(item, dict) or item.get("type") != "indicator":
            continue
        indicators.append(
            {
                "code": item.get("code"),
                "name": item.get("name"),
                "unit": item.get("unit"),
                "sql": (
                    item.get("calculation_rule")
                    or item.get("composite_formula")
                    or item.get("sql")
                ),
                "description": item.get("description") or _semantic_match_description(item),
            }
        )

    if not indicators:
        return None

    return {
        "codata_kind": "indicator",
        "indicators": indicators,
        "total": len(indicators),
    }


def _sql_from_args_or_payload(
    args: dict[str, Any],
    payload: dict[str, Any] | None = None,
) -> str:
    for source in (args, payload or {}):
        for key in ("sql", "query", "statement", "executed_sql"):
            val = source.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
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


def _semantic_match_description(item: dict[str, Any]) -> str | None:
    parts = []
    match = item.get("match")
    if match:
        parts.append(f"match: {match}")

    score = item.get("score")
    if isinstance(score, int | float):
        parts.append(f"score: {score:.2f}")

    return "; ".join(parts) or None
