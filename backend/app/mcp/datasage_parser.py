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
  search_indicators  → {"results":[{"code","name","calculation_rule",...}],
                        "total":N}
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

KNOWN_TOOLS = frozenset({EXECUTE_SQL, SEARCH_INDICATORS, COMPILE_METRIC_SQL})


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

    # The SQL text lives in the call args, not the response.
    sql = ""
    for key in ("sql", "query", "statement"):
        val = args.get(key)
        if isinstance(val, str) and val.strip():
            sql = val.strip()
            break

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
    raw_columns = payload.get("columns")
    raw_rows = payload.get("data")
    if isinstance(raw_columns, list) and isinstance(raw_rows, list):
        columns = [
            {"name": str(c)} if not isinstance(c, dict) else c
            for c in raw_columns
        ]
        row_count = int(payload.get("row_count", len(raw_rows)))
        rows = raw_rows[:MAX_ROWS]
        truncated = bool(payload.get("truncated")) or len(raw_rows) > MAX_ROWS
        return {
            "codata_kind": "sql_result",
            "sql": sql or None,
            "columns": columns,
            "rows": rows,
            "row_count": row_count,
            "truncated": truncated,
            "duration_ms": payload.get("duration_ms"),
        }

    return None


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
