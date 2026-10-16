"""Ollama local LLM provider.

Extends OpenAICompatProvider to leverage Ollama's OpenAI-compatible
``/v1/chat/completions`` endpoint for streaming, while using the native
``/api/tags`` endpoint for richer model discovery.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import httpx

from app.provider.openai_compat import OpenAICompatProvider
from app.schemas.provider import ModelCapabilities, ModelInfo, ModelPricing, ProviderStatus

logger = logging.getLogger(__name__)

# Patterns used to infer model capabilities from the model name.
_VISION_PATTERNS = re.compile(r"(llava|vision|bakllava|moondream|minicpm-v)", re.IGNORECASE)
_REASONING_PATTERNS = re.compile(r"(deepseek-r1|qwq|reasoner)", re.IGNORECASE)
_CODE_PATTERNS = re.compile(r"(coder|codellama|starcoder|deepseek-coder|code)", re.IGNORECASE)


def _infer_capabilities(
    name: str,
    details: dict[str, Any] | None,
    *,
    context_length: int | None = None,
) -> ModelCapabilities:
    """Best-effort capability inference from model name and Ollama metadata."""
    families = set()
    if details:
        families = {f.lower() for f in details.get("families", []) or []}

    has_vision = bool(_VISION_PATTERNS.search(name)) or "clip" in families
    has_reasoning = bool(_REASONING_PATTERNS.search(name))

    # Ollama models generally support tool/function calling via the
    # OpenAI-compatible endpoint for most recent model families.
    # Default to True — the runtime will gracefully degrade if unsupported.
    has_function_calling = True

    # Context size: use the real value from /api/show when available,
    # otherwise fall back to a conservative default.
    max_context = context_length or _DEFAULT_CONTEXT

    return ModelCapabilities(
        function_calling=has_function_calling,
        vision=has_vision,
        reasoning=has_reasoning,
        json_output=True,  # Ollama supports JSON mode via format param
        max_context=max_context,
    )


_DEFAULT_CONTEXT = 8192


async def _fetch_context_length(
    client: httpx.AsyncClient,
    base_url: str,
    model_name: str,
) -> int | None:
    """Query ``/api/show`` for the model's real context window.

    Returns the ``<arch>.context_length`` value from ``model_info``,
    or *None* if unavailable.
    """
    try:
        resp = await client.post(
            f"{base_url}/api/show",
            json={"name": model_name},
            timeout=10.0,
        )
        resp.raise_for_status()
        model_info: dict[str, Any] = resp.json().get("model_info", {})
        # Keys are like "llama.context_length", "qwen2.context_length", etc.
        for key, value in model_info.items():
            if key.endswith(".context_length") and isinstance(value, int):
                return value
    except Exception:
        logger.debug("Ollama: failed to fetch context_length for %s", model_name)
    return None


class OllamaProvider(OpenAICompatProvider):
    """Ollama local LLM provider.

    Inherits streaming and tool-calling from ``OpenAICompatProvider``
    via Ollama's ``/v1/chat/completions`` endpoint.  Model discovery
    uses the native ``/api/tags`` endpoint for richer metadata.
    """

    def __init__(self, base_url: str = "http://localhost:11434"):
        self._base_url = base_url.rstrip("/")
        # Ollama requires no real API key, but the OpenAI SDK mandates a
        # non-empty string.
        super().__init__(
            api_key="ollama",
            base_url=f"{self._base_url}/v1",
        )
        self._models_cache: list[ModelInfo] | None = None

    @property
    def id(self) -> str:  # noqa: A003
        return "ollama"

    # -- Model discovery -------------------------------------------------------

    async def list_models(self) -> list[ModelInfo]:
        """Fetch locally-available models from ``/api/tags``.

        For each model, queries ``/api/show`` in parallel to retrieve the
        real context window size (``<arch>.context_length``).
        """
        if self._models_cache is not None:
            return self._models_cache

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self._base_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()

        entries = [e for e in data.get("models", []) if e.get("name") or e.get("model")]

        # Fetch real context lengths in parallel via /api/show
        names = [e.get("name") or e.get("model", "") for e in entries]
        async with httpx.AsyncClient() as client:
            ctx_tasks = [
                _fetch_context_length(client, self._base_url, n) for n in names
            ]
            ctx_lengths = await asyncio.gather(*ctx_tasks)

        models: list[ModelInfo] = []
        for entry, ctx_len in zip(entries, ctx_lengths):
            name: str = entry.get("name", entry.get("model", ""))

            details: dict[str, Any] | None = entry.get("details")
            param_size = ""
            quant = ""
            if details:
                param_size = details.get("parameter_size", "")
                quant = details.get("quantization_level", "")

            display_parts = [name]
            if param_size:
                display_parts.append(param_size)
            if quant:
                display_parts.append(quant)
            display_name = " — ".join(display_parts)

            models.append(
                ModelInfo(
                    id=f"ollama/{name}",
                    name=display_name,
                    provider_id=self.id,
                    capabilities=_infer_capabilities(name, details, context_length=ctx_len),
                    pricing=ModelPricing(prompt=0.0, completion=0.0),
                    metadata={
                        "size": entry.get("size", 0),
                        "parameter_size": param_size,
                        "quantization_level": quant,
                        "family": details.get("family", "") if details else "",
                        "format": details.get("format", "") if details else "",
                    },
                )
            )

        self._models_cache = models
        logger.info("Ollama: discovered %d local model(s)", len(models))
        return models

    # -- Streaming override ----------------------------------------------------

    async def stream_chat(self, model: str, messages: list[dict[str, Any]], **kwargs: Any):
        """Stream chat, stripping the ``ollama/`` prefix for the Ollama API."""
        # The model ID stored in Codata is "ollama/<name>" but Ollama
        # expects just "<name>" in the API call.
        bare_model = model.removeprefix("ollama/")
        async for chunk in super().stream_chat(bare_model, messages, **kwargs):
            yield chunk

    # -- Health check ----------------------------------------------------------

    async def health_check(self) -> ProviderStatus:
        """Ping Ollama to verify it is running."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._base_url}/api/tags")
                resp.raise_for_status()
                model_count = len(resp.json().get("models", []))
            return ProviderStatus(status="connected", model_count=model_count)
        except Exception as e:
            return ProviderStatus(status="error", error=str(e))

    # -- Cache -----------------------------------------------------------------

    def clear_cache(self) -> None:
        self._models_cache = None
