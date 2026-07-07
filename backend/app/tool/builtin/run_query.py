"""run_query — reliable SQL execution against the datasage data platform.

A thin orchestration layer over datasage's raw ``execute_sql`` MCP tool that
the data agent uses instead of calling execute_sql directly. It adds the
reliability the model shouldn't have to hand-manage:

  - async jobs are polled to completion server-side (execute_sql may return a
    job_id for large queries; we poll get_job_status until done)
  - SQL errors come back as a clear tool error so the agent can self-correct
  - the result rides on metadata as ``codata_kind: "sql_result"`` — the exact
    shape the frontend DataResultCard already renders

No frontend change: output shape matches the existing execute_sql parse.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.mcp.datasage_client import extract_text, find_execute_sql_client
from app.mcp.datasage_parser import _parse_execute_sql, _parse_job_status
from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext

logger = logging.getLogger(__name__)

# Poll config for async jobs.
POLL_INTERVAL_SECONDS = 2.0
POLL_TIMEOUT_SECONDS = 60.0


class RunQueryTool(ToolDefinition):

    @property
    def id(self) -> str:
        return "run_query"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return (
            "Run a read SQL query against the connected data platform and return "
            "the result as a table (rendered in the user's data panel). Prefer this "
            "over calling execute_sql directly: large async queries are polled to "
            "completion for you, and SQL errors are returned so you can fix and retry. "
            "Confirm table/column names from a table profile before querying — do not "
            "guess. Pass a single SQL statement."
        )

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "sql": {
                    "type": "string",
                    "description": "A single read SQL statement to execute.",
                },
            },
            "required": ["sql"],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        sql = args.get("sql")
        if not isinstance(sql, str) or not sql.strip():
            return ToolResult(error="'sql' must be a non-empty SQL statement.")
        sql = sql.strip()

        client = find_execute_sql_client()
        if client is None:
            return ToolResult(error="数据源未连接,无法执行查询。请先连接 datasage 数据源。")

        # 1) Kick off the query.
        try:
            result = await client.call_tool("execute_sql", {"sql": sql})
        except Exception as e:  # noqa: BLE001
            return ToolResult(error=f"查询执行失败: {e}")

        output = extract_text(result)
        if getattr(result, "isError", False):
            # datasage's error text usually names the bad column / syntax spot —
            # surface it verbatim so the agent can self-correct next turn.
            return ToolResult(error=output or "查询返回错误")

        payload = _safe_json(output)
        if not isinstance(payload, dict):
            # Not JSON we understand — hand the raw text back.
            return ToolResult(output=output or "查询无输出")

        parsed = _parse_execute_sql({"sql": sql}, payload)

        # 2) Sync result → done.
        if parsed and parsed.get("codata_kind") == "sql_result":
            return _result_from_parsed(parsed, sql)

        # 3) Async job → poll get_job_status to completion.
        if parsed and parsed.get("codata_kind") == "sql_job":
            job_id = parsed.get("job_id") or ""
            if not job_id:
                return ToolResult(error="查询返回了异步任务但缺少 job_id,无法轮询。")
            return await self._poll_job(client, job_id, sql, ctx)

        # Unrecognised shape — return the raw text.
        return ToolResult(output=output or "查询无可解析结果")

    async def _poll_job(self, client, job_id, sql, ctx) -> ToolResult:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + POLL_TIMEOUT_SECONDS
        while True:
            if ctx.abort_event.is_set():
                return ToolResult(error="查询已中止。")
            if loop.time() >= deadline:
                return ToolResult(
                    error=f"查询超时(>{POLL_TIMEOUT_SECONDS:.0f}s),任务 {job_id} 仍在运行。"
                )

            ctx.publish_metadata(
                title="查询中",
                metadata={"codata_kind": "sql_job", "job_id": job_id, "status": "running"},
            )
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

            try:
                res = await client.call_tool("get_job_status", {"job_id": job_id})
            except Exception as e:  # noqa: BLE001
                return ToolResult(error=f"查询状态轮询失败: {e}")

            if getattr(res, "isError", False):
                return ToolResult(error=extract_text(res) or "查询状态返回错误")

            payload = _safe_json(extract_text(res))
            if not isinstance(payload, dict):
                continue  # transient / unparseable — keep polling until timeout

            parsed = _parse_job_status(payload)
            if parsed and parsed.get("codata_kind") == "sql_result":
                return _result_from_parsed(parsed, sql)

            status = str(payload.get("status", "")).lower()
            if status in ("failed", "error", "cancelled", "canceled"):
                return ToolResult(error=f"查询失败(状态 {status})。")
            # else running/pending → loop


def _safe_json(text: str) -> Any | None:
    t = (text or "").strip()
    if not t or t[0] not in "{[":
        return None
    try:
        return json.loads(t)
    except (json.JSONDecodeError, ValueError):
        return None


def _result_from_parsed(parsed: dict[str, Any], sql: str) -> ToolResult:
    """Wrap a parsed sql_result metadata dict into a ToolResult.

    metadata shape matches datasage_parser output → DataResultCard renders it.
    """
    meta = dict(parsed)
    # Ensure the executed SQL is present (parser may have inferred it already).
    meta.setdefault("sql", sql)
    row_count = meta.get("row_count", len(meta.get("rows", [])))
    col_count = len(meta.get("columns", []))
    return ToolResult(
        output=f"查询成功:{row_count} 行 · {col_count} 列",
        title="查询结果",
        metadata=meta,
    )
