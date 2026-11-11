"""Streaming tool executor — inspired by Claude Code's StreamingToolExecutor.

Key behavior:
  - Tools can be submitted during LLM streaming (before streaming completes)
  - Concurrent-safe tools start executing immediately in background tasks
  - Exclusive tools are queued and run sequentially after concurrent ones
  - Results are collected in submission order after streaming completes

This overlaps LLM network latency with tool I/O — the core performance
insight from Claude Code's architecture.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext

logger = logging.getLogger(__name__)


# Bash errors cancel sibling concurrent tools (inspired by Claude Code).
# Bash commands often form implicit dependency chains — if one fails,
# continuing siblings is pointless and can cause confusing cascading errors.
SIBLING_ABORT_TOOLS = frozenset({"bash"})


@dataclass
class ToolCallInfo:
    """A single tool call to be executed."""

    index: int  # Submission order
    tool: ToolDefinition
    tool_name: str
    tool_args: dict[str, Any]
    call_id: str
    ctx: ToolContext
    timeout: float = 300.0
    trace: Any = None
    trace_span_id: str = ''
    queue_span_id: str = ''
    producer_span_id: str = ''
    retry_of_call_id: str | None = None
    execution_span_id: str = ''
    on_started: Callable[['ToolCallInfo'], None] | None = None
    on_finished: Callable[['ToolCallInfo'], None] | None = None


@dataclass
class ToolExecutionResult:
    """Result of a single tool execution."""

    index: int
    tool_name: str
    call_id: str
    tool_args: dict[str, Any]
    result: ToolResult | None = None
    error: Exception | None = None
    timed_out: bool = False
    aborted_by_sibling: bool = False
    time_start: str | None = None
    time_end: str | None = None


async def _execute_single_inner(info: ToolCallInfo) -> ToolExecutionResult:
    """Execute a single tool call with timeout and error handling."""
    if info.ctx.is_aborted:
        return ToolExecutionResult(
            index=info.index, tool_name=info.tool_name,
            call_id=info.call_id, tool_args=info.tool_args,
            error=asyncio.CancelledError("Aborted"),
        )
    try:
        result = await asyncio.wait_for(
            info.tool(info.tool_args, info.ctx),
            timeout=info.timeout,
        )
        return ToolExecutionResult(
            index=info.index, tool_name=info.tool_name,
            call_id=info.call_id, tool_args=info.tool_args,
            result=result,
        )
    except asyncio.TimeoutError:
        return ToolExecutionResult(
            index=info.index, tool_name=info.tool_name,
            call_id=info.call_id, tool_args=info.tool_args,
            timed_out=True,
        )
    except Exception as e:
        return ToolExecutionResult(
            index=info.index, tool_name=info.tool_name,
            call_id=info.call_id, tool_args=info.tool_args,
            error=e,
        )


async def _execute_single(info: ToolCallInfo) -> ToolExecutionResult:
    """Measure actual scheduling delay, including the exclusive queue."""
    trace = info.trace
    time_start = datetime.now(timezone.utc).isoformat()
    if trace:
        execution_started = trace.now()
        trace.finish(info.queue_span_id, end_ms=execution_started)
        execution = trace.start('工具执行', '工具', parent_id=info.trace_span_id,
                                start_ms=execution_started,attributes={'call_id': info.call_id})
        info.execution_span_id = execution
        if info.on_started:
            info.on_started(info)
    try:
        if trace:
            with trace.bind(execution):
                result = await _execute_single_inner(info)
        else:
            result = await _execute_single_inner(info)
        result.time_start = time_start
        result.time_end = datetime.now(timezone.utc).isoformat()
        if trace:
            execution_ended = trace.now()
            status = 'cancelled' if result.aborted_by_sibling or isinstance(result.error, asyncio.CancelledError) else 'error' if result.error or result.timed_out or (result.result and result.result.error) else 'ok'
            trace.finish(execution, status, end_ms=execution_ended)
            trace.finish(info.trace_span_id, status, end_ms=execution_ended,time_start=result.time_start, time_end=result.time_end,
                         timed_out=result.timed_out,
                         output_preview=(str(result.result.output)[:2000] if result.result else ''),
                         error_preview=str(result.result.error or '')[:500] if result.result else type(result.error).__name__ if result.error else '')
        return result
    except BaseException:
        if trace:
            stopped=trace.now()
            trace.finish(execution, 'cancelled',end_ms=stopped)
            trace.finish(info.trace_span_id, 'cancelled',end_ms=stopped)
        raise
    finally:
        if info.on_finished:
            info.on_finished(info)


class StreamingToolExecutor:
    """Manages tool execution during and after LLM streaming.

    Usage:
        executor = StreamingToolExecutor(abort_event)

        # During streaming — called each time a tool-call chunk arrives:
        executor.submit(tool_call_info)

        # After streaming completes — wait for all results:
        results = await executor.collect()
    """

    def __init__(self, abort_event: asyncio.Event) -> None:
        self._abort = abort_event
        self._concurrent_tasks: list[tuple[ToolCallInfo, asyncio.Task]] = []
        self._exclusive_queue: list[ToolCallInfo] = []
        self._results: dict[int, ToolExecutionResult] = {}
        self._submission_order: list[int] = []
        # Sibling abort: set when a bash tool errors, cancels other concurrent tasks
        self._sibling_errored = False
        self._sibling_error_desc = ""
        self._parallel_batches: dict[str, dict[str, Any]] = {}
        self._collecting = False

    def _parallel_submitted(self, info: ToolCallInfo) -> None:
        # A fork means the executor actually created independent safe tasks
        # for this model response. Tiny synchronous bodies may not overlap;
        # peak execution concurrency is recorded separately, without pretending.
        if not info.trace or info.trace.completed or not info.trace_span_id or not info.tool.is_concurrency_safe:
            return
        batch = self._parallel_batches.setdefault(info.producer_span_id, {
            'members': [], 'active': set(), 'peak': 0, 'span': '', 'join': '', 'trace': info.trace,
        })
        batch['members'].append(info)
        if len(batch['members']) < 2:
            return
        trace = info.trace
        members = [item.trace_span_id for item in batch['members']]
        start = min(trace.spans[key]['startMs'] for key in members)
        if not batch['span']:
            batch['span'] = trace.start('并行分支', '调度', parent_id=trace.root_id, start_ms=start,
                attributes={'group_kind':'parallel', 'dispatch_strategy':'concurrent_tasks',
                            'timing_basis':'first submission to last member result; actual overlap shown in child spans'})
            if not batch['span']:
                return
            batch['join'] = trace.start('结果汇合', '调度', parent_id=batch['span'], start_ms=start,
                attributes={'checkpoint':'join', 'timing_basis':'same batch wall time, not additional serial cost'})
        group = trace.spans[batch['span']]
        group['startMs'] = min(group['startMs'], start)
        group['attributes'].update(group_members=members, join_span_id=batch['join'],
                                  active_count=len(batch['active']), peak_concurrency=batch['peak'])
        trace._emit(group)
        if batch['join']:
            trace.spans[batch['join']]['startMs'] = group['startMs']
            trace.spans[batch['join']]['attributes']['group_members'] = members
            trace._emit(trace.spans[batch['join']])
        for item in batch['members']:
            span = trace.spans[item.trace_span_id]
            span['parentId'] = batch['span']
            span['attributes']['parallel_group_id'] = batch['span']
            trace._emit(span)

    def _parallel_started(self, info: ToolCallInfo) -> None:
        batch = self._parallel_batches.get(info.producer_span_id)
        if not batch or info.trace.completed or not info.tool.is_concurrency_safe:
            return
        batch['active'].add(info.call_id)
        batch['peak'] = max(batch['peak'], len(batch['active']))
        if batch['span']:
            group = info.trace.spans[batch['span']]
            group['attributes'].update(active_count=len(batch['active']), peak_concurrency=batch['peak'])
            info.trace._emit(group)

    def _finish_parallel_batch(self, batch: dict[str, Any]) -> None:
        if not batch['span'] or not self._collecting or batch['trace'].completed:
            return
        trace = batch['trace']
        members = [trace.spans[item.trace_span_id] for item in batch['members']]
        if any(span['status']=='running' for span in members):
            return
        ended = max(span['startMs']+span['durationMs'] for span in members)
        status = 'cancelled' if any(span['status']=='cancelled' for span in members) else 'ok'
        failed = sum(span['status']=='error' for span in members)
        trace.spans[batch['span']]['attributes'].update(active_count=0, peak_concurrency=batch['peak'])
        trace.finish(batch['join'], status, end_ms=ended, failed_count=failed)
        trace.finish(batch['span'], status, end_ms=ended, failed_count=failed)

    def _parallel_finished(self, info: ToolCallInfo) -> None:
        batch = self._parallel_batches.get(info.producer_span_id)
        if not batch or not info.tool.is_concurrency_safe:
            return
        batch['active'].discard(info.call_id)
        self._finish_parallel_batch(batch)

    def submit(self, info: ToolCallInfo) -> None:
        """Submit a tool for execution.

        Concurrent-safe tools start immediately as background tasks.
        Exclusive tools are queued for sequential execution after streaming.
        """
        self._submission_order.append(info.index)
        info.on_started = self._parallel_started
        info.on_finished = self._parallel_finished
        from app.streaming.trace import current_trace
        active = current_trace()
        if active:
            info.trace, producer = active
            info.trace_span_id = info.trace.start(info.tool_name, '工具', kind='tool', parent_id=info.trace.root_id,
                attributes={'call_id': info.call_id, 'message_id': info.ctx.message_id,
                            'producer_span_id': info.producer_span_id or producer, 'input': info.tool_args,
                            'concurrent': info.tool.is_concurrency_safe,
                            'timing_basis':'submission to result ready; queue and execution share boundary'})
            info.queue_span_id = info.trace.start('工具排队', '工具排队', parent_id=info.trace_span_id,
                start_ms=info.trace.spans[info.trace_span_id]['startMs'] if info.trace_span_id else None)
            if info.retry_of_call_id and info.trace_span_id:
                previous = next((s for s in info.trace.spans.values() if s['kind']=='tool'
                    and s['name']==info.tool_name and s['attributes'].get('call_id')==info.retry_of_call_id
                    and s['status'] in ('error','cancelled')), None)
                if previous:
                    info.trace.spans[info.trace_span_id]['attributes'].update(
                        retry_of=previous['id'], relation_basis='explicit executor retry_of_call_id')
                    info.trace._emit(info.trace.spans[info.trace_span_id])
            self._parallel_submitted(info)

        if info.tool.is_concurrency_safe:
            task = asyncio.create_task(
                _execute_single(info),
                name=f"tool-{info.tool_name}-{info.call_id[:8]}",
            )
            self._concurrent_tasks.append((info, task))
            logger.info(
                "Started concurrent tool %s (call_id=%s) during streaming",
                info.tool_name, info.call_id[:8],
            )
        else:
            self._exclusive_queue.append(info)
            logger.debug(
                "Queued exclusive tool %s (call_id=%s) for post-stream execution",
                info.tool_name, info.call_id[:8],
            )

    async def collect(self) -> list[ToolExecutionResult]:
        """Wait for all submitted tools to complete and return results in order.

        1. Await all concurrent background tasks (with sibling abort)
        2. Execute exclusive tools sequentially
        3. Return results sorted by submission order
        """
        self._collecting = True
        # 1. Collect concurrent results
        for info, task in self._concurrent_tasks:
            try:
                result = await task
                self._results[result.index] = result

                # Sibling abort: if a bash tool errored, cancel remaining
                # concurrent tasks. Bash commands often have implicit dependency
                # chains — if one fails, continuing siblings is pointless.
                if (
                    result.error is not None
                    and result.tool_name in SIBLING_ABORT_TOOLS
                    and not self._sibling_errored
                ):
                    self._sibling_errored = True
                    _input_summary = str(info.tool_args.get("command", ""))[:40]
                    self._sibling_error_desc = (
                        f"{info.tool_name}({_input_summary})"
                        if _input_summary else info.tool_name
                    )
                    logger.info(
                        "Bash tool %s errored — cancelling sibling concurrent tasks",
                        info.call_id[:8],
                    )
                    self._cancel_remaining_concurrent(info.index)

            except asyncio.CancelledError:
                # Task was cancelled by sibling abort or external abort
                if info.trace:
                    stopped=info.trace.now()
                    info.trace.finish(info.queue_span_id,'cancelled',end_ms=stopped)
                    info.trace.finish(info.execution_span_id,'cancelled',end_ms=stopped)
                    info.trace.finish(info.trace_span_id,'cancelled',end_ms=stopped)
                msg = (
                    f"Cancelled: parallel tool call {self._sibling_error_desc} errored"
                    if self._sibling_errored
                    else "Cancelled"
                )
                self._results[info.index] = ToolExecutionResult(
                    index=info.index, tool_name=info.tool_name,
                    call_id=info.call_id, tool_args=info.tool_args,
                    error=asyncio.CancelledError(msg),
                    aborted_by_sibling=self._sibling_errored,
                )
            except Exception as e:
                self._results[info.index] = ToolExecutionResult(
                    index=info.index, tool_name=info.tool_name,
                    call_id=info.call_id, tool_args=info.tool_args,
                    error=e,
                )

        for batch in self._parallel_batches.values():
            self._finish_parallel_batch(batch)

        # 2. Execute exclusive tools sequentially
        for info in self._exclusive_queue:
            if self._abort.is_set() or self._sibling_errored:
                if info.trace:
                    info.trace.finish(info.queue_span_id, 'cancelled')
                    info.trace.finish(info.trace_span_id, 'cancelled')
                msg = (
                    f"Cancelled: parallel tool call {self._sibling_error_desc} errored"
                    if self._sibling_errored
                    else "Aborted"
                )
                self._results[info.index] = ToolExecutionResult(
                    index=info.index, tool_name=info.tool_name,
                    call_id=info.call_id, tool_args=info.tool_args,
                    error=asyncio.CancelledError(msg),
                    aborted_by_sibling=self._sibling_errored,
                )
                continue

            result = await _execute_single(info)
            self._results[result.index] = result

        # 3. Return in submission order
        return [
            self._results[idx]
            for idx in self._submission_order
            if idx in self._results
        ]

    def _cancel_remaining_concurrent(self, errored_index: int) -> None:
        """Cancel all concurrent tasks that haven't completed yet."""
        for info, task in self._concurrent_tasks:
            if info.index != errored_index and not task.done():
                task.cancel()
                logger.debug(
                    "Cancelled sibling tool %s (call_id=%s)",
                    info.tool_name, info.call_id[:8],
                )

    def cancel_all(self) -> None:
        """Cancel all pending concurrent tasks."""
        for _, task in self._concurrent_tasks:
            if not task.done():
                task.cancel()

    @property
    def has_submissions(self) -> bool:
        return bool(self._submission_order)
