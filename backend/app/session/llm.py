"""LLM streaming bridge.

Handles:
  - System prompt assembly
  - Tool spec resolution
  - Provider streaming call
  - Reasoning token passthrough
"""

from __future__ import annotations

from typing import Any, AsyncIterator
from contextlib import nullcontext

from app.provider.base import BaseProvider
from app.schemas.agent import AgentInfo
from app.schemas.provider import StreamChunk
from app.tool.registry import ToolRegistry
from app.streaming.trace import trace_span


async def stream_llm(
    provider: BaseProvider,
    model_id: str,
    messages: list[dict[str, Any]],
    *,
    system_prompt: str | list[dict[str, Any]],
    agent: AgentInfo,
    tool_registry: ToolRegistry,
    extra_body: dict[str, Any] | None = None,
    max_tokens: int | None = None,
    exclude_tools: set[str] | None = None,
    discovered_tools: set[str] | None = None,
    response_format: dict[str, Any] | None = None,
    trace_attributes: dict[str, Any] | None = None,
) -> AsyncIterator[StreamChunk]:
    """Unified LLM streaming call.

    Assembles system prompt, resolves tools, and calls provider.
    When response_format is set (e.g. json_schema), tools are disabled —
    most providers do not support both simultaneously.
    """
    # Resolve tool specs for this agent; disable when structured output is requested
    from app.streaming.trace import current_trace
    import time
    attrs = {'model': model_id, 'provider': provider.id, **(trace_attributes or {})}
    active = current_trace()
    if active and attrs.get('attempt', 1) > 1:
        previous = [s for s in active[0].spans.values() if s['kind'] == 'model' and s['attributes'].get('message_id') == attrs.get('message_id')]
        if previous:
            attrs['retry_of'] = previous[-1]['id']
    trace = active[0] if active else None
    model_id_span = trace.start('模型响应 / 参数准备', '模型', kind='model', parent_id=active[1], attributes=attrs) if active else ''
    # Do not hold a ContextVar token across an async-generator yield: early
    # cancellation may close that generator from a different asyncio context.
    with trace.bind(model_id_span) if trace else nullcontext():
        with trace_span('本地准备与工具协议装配', '调度'):
            tool_specs = None if response_format else tool_registry.to_openai_specs(
                agent, exclude=exclude_tools, discovered=discovered_tools,
            )
    stream = provider.stream_chat(
            model_id, messages, system=system_prompt, tools=tool_specs if tool_specs else None,
            temperature=agent.temperature, max_tokens=max_tokens, extra_body=extra_body,
            response_format=response_format,
    )
    wait_ms = 0.0
    status = 'ok'
    try:
        while True:
            started = time.perf_counter_ns()
            try:
                with trace.bind(model_id_span) if trace else nullcontext():
                    chunk = await anext(stream)
            except StopAsyncIteration:
                break
            finally:
                wait_ms += (time.perf_counter_ns() - started) / 1_000_000
            if chunk.type == 'error':
                status = 'error'
            if trace and chunk.type == 'tool-call':
                chunk.data['_trace_model_span_id'] = model_id_span
            yield chunk
    except BaseException:
        status = 'cancelled'
        raise
    finally:
        await stream.aclose()
        if trace:
            trace.finish(model_id_span, status, provider_await_ms=wait_ms,
                         duration_note='总跨度含流消费 / 本地调度等待，provider_await_ms 为等待提供商分块累计，不能当独立连续跨度')
