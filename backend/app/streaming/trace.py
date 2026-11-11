"""Bounded, monotonic execution traces. Observation never contains model reasoning.

Spans are streamed as upserts (stable IDs), then saved on the answer message.
ContextVars isolate concurrent runs and propagate through asyncio/to_thread.
"""
from __future__ import annotations

import contextvars
import functools
import time
import math
import re
from copy import deepcopy
from contextlib import contextmanager
from typing import Any, Callable, Iterator
from uuid import uuid4

_context: contextvars.ContextVar[tuple['TraceRecorder', str] | None] = contextvars.ContextVar('execution_trace', default=None)
MAX_SPANS = 2000
_SECRET_KEYS = ('authorization', 'password', 'secret', 'api_key', 'access_token', 'refresh_token', 'cookie')


def safe_value(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return '[depth limit]'
    if isinstance(value, dict):
        return {str(k): '[redacted]' if any(s in str(k).lower() for s in _SECRET_KEYS) else safe_value(v, depth + 1)
                for k, v in list(value.items())[:60]}
    if isinstance(value, (list, tuple)):
        return [safe_value(v, depth + 1) for v in value[:30]]
    if isinstance(value, str):
        value = re.sub(r'(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [redacted]', value)
        value = re.sub(r'\bsk-[A-Za-z0-9_-]{8,}', '[redacted]', value)
        return value[:8000] + ('… [truncated]' if len(value) > 8000 else '')
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return str(value)[:500]


class TraceRecorder:
    def __init__(self, trace_id: str, publish: Callable[[dict], None]) -> None:
        self.trace_id = trace_id
        self.origin_ns = time.perf_counter_ns()
        self.origin_epoch_ms = time.time() * 1000
        self.publish = publish
        self.spans: dict[str, dict] = {}
        self.message_ids: list[str] = []
        self.completed = False
        self.dropped = 0
        self.root_id = self.start('Agent 请求', '请求', kind='request', parent_id=None, span_id='request', emit=False)

    def now(self) -> float:
        return (time.perf_counter_ns() - self.origin_ns) / 1_000_000

    def _emit(self, span: dict) -> None:
        if self.completed:
            return
        self.publish({'trace_id': self.trace_id, 'origin_epoch_ms': self.origin_epoch_ms,
                      'span': deepcopy(span), 'elapsed_ms': self.now()})

    def start(self, name: str, service: str, *, kind: str = 'phase', parent_id: str | None = None,
              span_id: str | None = None, attributes: dict | None = None, emit: bool = True,
              start_ms: float | None = None) -> str:
        if self.completed:
            return ''
        if len(self.spans) >= MAX_SPANS:
            self.dropped += 1
            return ''
        key = span_id or uuid4().hex[:16]
        self.spans[key] = {'id': key, 'parentId': parent_id, 'name': name, 'service': service,
                           'kind': kind, 'startMs': self.now() if start_ms is None else max(0,start_ms), 'durationMs': 0,
                           'status': 'running', 'attributes': safe_value(attributes or {})}
        if emit:
            self._emit(self.spans[key])
        return key

    def finish(self, key: str, status: str = 'ok', *, end_ms: float | None = None, **attributes: Any) -> None:
        if self.completed:
            return
        s = self.spans.get(key)
        if not s or s['status'] != 'running':
            return
        s.update(durationMs=max(0, (self.now() if end_ms is None else end_ms) - s['startMs']), status=status)
        s['attributes'] = {**s['attributes'], **safe_value(attributes)}
        self._emit(s)

    @contextmanager
    def bind(self, parent_id: str | None = None) -> Iterator[None]:
        token = _context.set((self, parent_id or self.root_id))
        try:
            yield
        finally:
            _context.reset(token)

    def snapshot(self) -> dict:
        return {'version': 1, 'trace_id': self.trace_id, 'origin_epoch_ms': self.origin_epoch_ms,
                'duration_ms': self.spans[self.root_id]['durationMs'] if self.completed else self.now(),
                'completed': self.completed, 'dropped_spans': self.dropped,
                'spans': list(self.spans.values())}

    def close(self, status: str = 'ok') -> None:
        if self.completed:
            return
        ended = self.now()
        for key in reversed(list(self.spans)):
            if key != self.root_id and self.spans[key]['status'] == 'running':
                self.finish(key, 'cancelled' if status != 'ok' else 'incomplete', end_ms=ended)
        self.finish(self.root_id, status, end_ms=ended)
        self.completed = True

    async def persist(self, session_factory) -> None:
        if not self.message_ids:
            return
        from app.models.message import Message
        async with session_factory() as db:
            async with db.begin():
                # The last surviving answer owns the snapshot; all steps carry trace_id.
                for message_id in reversed(self.message_ids):
                    row = await db.get(Message, message_id)
                    if row is not None:
                        row.data = {**row.data, 'trace_id': self.trace_id, 'execution_trace': self.snapshot()}
                        break


def current_trace() -> tuple[TraceRecorder, str] | None:
    active = _context.get()
    return active if active and not active[0].completed else None


@contextmanager
def trace_span(name: str, service: str, *, kind: str = 'phase', attributes: dict | None = None) -> Iterator[tuple[TraceRecorder, str] | None]:
    active = current_trace()
    if active is None:
        yield None
        return
    trace, parent = active
    key = trace.start(name, service, kind=kind, parent_id=parent, attributes=attributes)
    try:
        with trace.bind(key or parent):
            yield (trace, key)
    except BaseException as exc:
        trace.finish(key, 'cancelled' if isinstance(exc, (KeyboardInterrupt, GeneratorExit)) or type(exc).__name__ == 'CancelledError' else 'error', error_type=type(exc).__name__)
        raise
    else:
        trace.finish(key)


def traced(name: str, service: str, kind: str = 'phase'):
    def decorate(fn):
        @functools.wraps(fn)
        async def wrapped(*args, **kwargs):
            with trace_span(name, service, kind=kind):
                return await fn(*args, **kwargs)
        return wrapped
    return decorate


class ProviderTiming:
    """Provider boundary, including actual tool/reasoning deltas, not buffered calls."""
    def __init__(self) -> None:
        self.active = current_trace()
        self.wait_id = ''
        self.decode_id = ''
        if self.active:
            trace, parent = self.active
            self.wait_id = trace.start('请求发出 → 首 token', '模型', parent_id=parent,
                                       attributes={'boundary': 'SDK 请求发起 → 首个有效内容 / 推理 / 工具 delta', 'clock': 'server monotonic'})

    def first_token(self) -> None:
        if self.active and not self.decode_id:
            trace, parent = self.active
            trace.finish(self.wait_id)
            self.decode_id = trace.start('后续流式生成', '模型', parent_id=parent)

    def finish(self, status: str = 'ok') -> None:
        if self.active:
            trace, _ = self.active
            trace.finish(self.wait_id, status if status != 'ok' else 'incomplete', note='未收到有效 delta')
            trace.finish(self.decode_id, status)
