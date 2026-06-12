"""LLM adapter for expert team runs."""

from __future__ import annotations

from typing import Any

from app.provider.registry import ProviderRegistry
from app.schemas.provider import StreamChunk
from app.session.utils import strip_image_content


class ExpertLLMAdapter:
    """Resolve and call WorkCraft providers for an expert member."""

    def __init__(self, provider_registry: ProviderRegistry) -> None:
        self._provider_registry = provider_registry

    async def stream(
        self,
        *,
        model: str | None,
        provider_id: str | None,
        messages: list[dict[str, Any]],
        system: str,
        tools: list[dict[str, Any]] | None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        extra_body: dict[str, Any] | None = None,
        response_format: dict[str, Any] | None = None,
    ):
        resolved_model = model
        if not resolved_model:
            all_models = self._provider_registry.all_models()
            if not all_models:
                await self._provider_registry.refresh_models()
                all_models = self._provider_registry.all_models()
            if not all_models:
                raise RuntimeError("No model configured")
            resolved_model = all_models[0].id

        resolved = self._provider_registry.resolve_model(resolved_model, provider_id)
        if not resolved:
            await self._provider_registry.refresh_models()
            resolved = self._provider_registry.resolve_model(resolved_model, provider_id)
        if not resolved:
            raise RuntimeError(f"Model not found: {resolved_model}")

        provider, model_info = resolved
        llm_messages = messages
        if model_info and not model_info.capabilities.vision:
            llm_messages = strip_image_content(messages)
        llm_tools = None if response_format else tools

        async for chunk in provider.stream_chat(
            resolved_model,
            llm_messages,
            system=system,
            tools=llm_tools,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_body=extra_body,
            response_format=response_format,
        ):
            yield chunk


def is_terminal_finish(chunk: StreamChunk) -> bool:
    return chunk.type == "finish"
