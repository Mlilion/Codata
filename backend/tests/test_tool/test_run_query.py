"""Tests for app.tool.builtin.run_query — reliable SQL execution."""

from __future__ import annotations

import json

import pytest

from app.schemas.agent import AgentInfo
from app.tool.builtin import run_query as run_query_mod
from app.tool.builtin.run_query import RunQueryTool, _format_rows_preview
from app.tool.context import ToolContext


def _ctx() -> ToolContext:
    return ToolContext(
        session_id="s", message_id="m",
        agent=AgentInfo(name="data", description="", mode="primary"),
        call_id="c",
    )


class _Item:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class _Res:
    def __init__(self, text: str, is_error: bool = False):
        self.content = [_Item(text)]
        self.isError = is_error


class _FakeClient:
    """Scriptable execute_sql / get_job_status client."""

    def __init__(self, responses: dict[str, list]):
        # tool name -> list of _Res (popped in order; last repeats)
        self._responses = responses
        self.calls: list[tuple[str, dict]] = []

    async def call_tool(self, name, args):
        self.calls.append((name, args))
        queue = self._responses.get(name, [])
        if not queue:
            raise RuntimeError(f"no scripted response for {name}")
        return queue.pop(0) if len(queue) > 1 else queue[0]


def _install(monkeypatch, client):
    monkeypatch.setattr(run_query_mod, "find_execute_sql_client", lambda *a, **k: client)


def _sync_result(rows, columns):
    return _Res(json.dumps({
        "mode": "sync", "columns": columns, "data": rows,
        "row_count": len(rows), "truncated": False,
    }))


@pytest.mark.asyncio
class TestRunQuery:
    async def test_missing_sql(self):
        r = await RunQueryTool().execute({}, _ctx())
        assert not r.success and "sql" in (r.error or "")

    async def test_no_datasource(self, monkeypatch):
        _install(monkeypatch, None)
        r = await RunQueryTool().execute({"sql": "SELECT 1"}, _ctx())
        assert not r.success and "数据源未连接" in r.error

    async def test_sync_result(self, monkeypatch):
        client = _FakeClient({
            "execute_sql": [_sync_result([["App", 10]], ["channel", "dau"])],
        })
        _install(monkeypatch, client)
        r = await RunQueryTool().execute({"sql": "SELECT channel, dau FROM t"}, _ctx())
        assert r.success
        assert r.metadata["codata_kind"] == "sql_result"
        assert r.metadata["rows"] == [["App", 10]]
        assert r.metadata["sql"] == "SELECT channel, dau FROM t"

    async def test_sql_error_surfaced(self, monkeypatch):
        client = _FakeClient({"execute_sql": [_Res("Unknown column 'foo'", is_error=True)]})
        _install(monkeypatch, client)
        r = await RunQueryTool().execute({"sql": "SELECT foo FROM t"}, _ctx())
        assert not r.success
        assert "Unknown column" in r.error

    async def test_async_job_polled_to_success(self, monkeypatch):
        # execute_sql returns a job; get_job_status runs once then succeeds.
        client = _FakeClient({
            "execute_sql": [_Res(json.dumps({"mode": "async", "job_id": "j1", "estimated_seconds": 3}))],
            "get_job_status": [
                _Res(json.dumps({"status": "running", "job_id": "j1"})),
                _Res(json.dumps({
                    "status": "success", "job_id": "j1",
                    "columns": ["n"], "data": [[1], [2]], "row_count": 2,
                })),
            ],
        })
        _install(monkeypatch, client)
        # Skip real sleeps.
        monkeypatch.setattr(run_query_mod.asyncio, "sleep", _no_sleep)

        r = await RunQueryTool().execute({"sql": "SELECT big"}, _ctx())
        assert r.success
        assert r.metadata["codata_kind"] == "sql_result"
        assert r.metadata["rows"] == [[1], [2]]
        # polled at least once
        assert any(name == "get_job_status" for name, _ in client.calls)

    async def test_async_job_failed(self, monkeypatch):
        client = _FakeClient({
            "execute_sql": [_Res(json.dumps({"mode": "async", "job_id": "j2"}))],
            "get_job_status": [_Res(json.dumps({"status": "failed", "job_id": "j2"}))],
        })
        _install(monkeypatch, client)
        monkeypatch.setattr(run_query_mod.asyncio, "sleep", _no_sleep)
        r = await RunQueryTool().execute({"sql": "SELECT big"}, _ctx())
        assert not r.success
        assert "失败" in r.error

    async def test_abort_stops_polling(self, monkeypatch):
        client = _FakeClient({
            "execute_sql": [_Res(json.dumps({"mode": "async", "job_id": "j3"}))],
            "get_job_status": [_Res(json.dumps({"status": "running", "job_id": "j3"}))],
        })
        _install(monkeypatch, client)
        monkeypatch.setattr(run_query_mod.asyncio, "sleep", _no_sleep)
        ctx = _ctx()
        ctx.abort_event.set()  # already aborted
        r = await RunQueryTool().execute({"sql": "SELECT big"}, ctx)
        assert not r.success and "中止" in r.error

    async def test_sync_result_feeds_rows_to_output(self, monkeypatch):
        client = _FakeClient({
            "execute_sql": [_sync_result([["App", 10], ["Web", 20]], ["channel", "dau"])],
        })
        _install(monkeypatch, client)
        r = await RunQueryTool().execute({"sql": "SELECT channel, dau FROM t"}, _ctx())
        assert r.success
        # metadata 形状不变
        assert r.metadata["rows"] == [["App", 10], ["Web", 20]]
        # output 现在含可读的数据预览，模型能看到实际值
        assert "channel" in r.output and "dau" in r.output
        assert "App" in r.output and "10" in r.output
        assert "2 行" in r.output
        assert "{'name'" not in r.output and '{"name"' not in r.output

    async def test_empty_result_output(self, monkeypatch):
        client = _FakeClient({"execute_sql": [_sync_result([], ["channel", "dau"])]})
        _install(monkeypatch, client)
        r = await RunQueryTool().execute({"sql": "SELECT channel, dau FROM t WHERE 1=0"}, _ctx())
        assert r.success
        assert "无数据行匹配" in r.output


def test_format_rows_preview_caps_rows():
    cols = ["a"]
    rows = [[i] for i in range(120)]
    out = _format_rows_preview(cols, rows, row_count=120)
    # 只预览前 50 行 + 标注总数
    assert out.count("\n") < 60
    assert "120" in out  # 总行数标注
    assert "前 50 行" in out


def test_format_rows_preview_truncates_wide_cell():
    cols = ["blob"]
    rows = [["x" * 500]]
    out = _format_rows_preview(cols, rows, row_count=1)
    assert "…" in out
    assert "x" * 500 not in out


async def _no_sleep(_seconds):
    return None
