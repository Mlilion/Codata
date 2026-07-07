"""Debounced async queue for structured analysis-memory updates.

Mirrors WorkspaceMemoryUpdateQueue but: keyed by user_id (single global user in
open-source), produces a structured JSON memory (not freeform text), and only
runs for data-analysis (codata) sessions. Debounced so rapid turns coalesce.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.memory.analysis_memory_storage import get_analysis_memory, upsert_analysis_memory
from app.memory.analysis_memory_updater import (
    build_extraction_prompt,
    parse_analysis_memory_response,
)
from app.memory.workspace_memory_updater import format_conversation_for_workspace_update

logger = logging.getLogger(__name__)


@dataclass
class AnalysisConversationContext:
    session_id: str
    user_id: str | None
    messages: list[dict[str, Any]]
    model_id: str | None = None
    timestamp: float = field(default_factory=time.time)


class AnalysisMemoryUpdateQueue:
    """Debounced queue that refreshes structured analysis memory after sessions."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        provider_registry: Any,
        *,
        debounce_seconds: int = 10,
    ) -> None:
        self._session_factory = session_factory
        self._provider_registry = provider_registry
        self._debounce_seconds = debounce_seconds
        self._pending: dict[str, AnalysisConversationContext] = {}
        self._timer: asyncio.TimerHandle | None = None
        self._lock = asyncio.Lock()

    def add(
        self,
        session_id: str,
        user_id: str | None,
        messages: list[dict[str, Any]],
        *,
        model_id: str | None = None,
    ) -> None:
        # Key by user_id (None -> "" for the single open-source user).
        self._pending[user_id or ""] = AnalysisConversationContext(
            session_id=session_id,
            user_id=user_id,
            messages=messages,
            model_id=model_id,
        )
        if self._timer is not None:
            self._timer.cancel()
        loop = asyncio.get_event_loop()
        self._timer = loop.call_later(
            self._debounce_seconds,
            lambda: asyncio.ensure_future(self._process()),
        )

    async def _process(self) -> None:
        async with self._lock:
            pending = self._pending
            self._pending = {}
        for ctx in pending.values():
            try:
                await self._refresh(ctx)
            except Exception:
                logger.exception("Analysis memory: refresh failed")

    async def _refresh(self, ctx: AnalysisConversationContext) -> None:
        conversation_text = format_conversation_for_workspace_update(ctx.messages)
        if not conversation_text.strip():
            return

        current = await get_analysis_memory(self._session_factory, ctx.user_id)
        prompt = build_extraction_prompt(current, conversation_text)
        response_text = await self._call_llm(prompt, model_id=ctx.model_id)
        parsed = parse_analysis_memory_response(response_text or "")
        if parsed is None:
            logger.info("Analysis memory: no valid JSON update, keeping existing memory")
            return
        await upsert_analysis_memory(self._session_factory, parsed, ctx.user_id)
        logger.info("Analysis memory: updated (session %s)", ctx.session_id)

    async def _call_llm(self, prompt: str, *, model_id: str | None = None) -> str | None:
        try:
            effective = model_id
            if not effective:
                models = self._provider_registry.all_models()
                effective = models[0].id if models else None
            if not effective:
                return None
            resolved = self._provider_registry.resolve_model(effective)
            if not resolved:
                return None
            provider, _info = resolved
            system = (
                "You extract structured data-analysis memory. "
                "Respond with a single JSON object only — no prose, no markdown fences."
            )
            messages = [{"role": "user", "content": prompt}]
            text = ""
            async for chunk in provider.stream_chat(
                effective, messages, system=system, max_tokens=2000
            ):
                if chunk.type == "text-delta":
                    text += chunk.data.get("text", "")
            return text or None
        except Exception:
            logger.exception("Analysis memory: LLM call failed")
            return None


_analysis_memory_queue: AnalysisMemoryUpdateQueue | None = None


def get_analysis_memory_queue() -> AnalysisMemoryUpdateQueue | None:
    return _analysis_memory_queue


def set_analysis_memory_queue(queue: AnalysisMemoryUpdateQueue) -> None:
    global _analysis_memory_queue
    _analysis_memory_queue = queue
