"""Shared default-model resolution for headless generation paths.

Channels, the scheduler, and the OpenAI-compat API all run without a browser,
so they cannot see the model a user picked in the UI. That choice is mirrored
server-side (``settings.default_model`` / ``default_provider_id``); this helper
prefers it and falls back to a simple registry heuristic only when it is unset
or no longer available.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.config import Settings
    from app.provider.registry import ProviderRegistry


def resolve_default_model(
    registry: ProviderRegistry,
    settings: Settings,
) -> tuple[str | None, str | None]:
    """Resolve the model for a headless request.

    Returns ``(model_id, provider_id)``. ``provider_id`` matters because a
    default backed by a custom endpoint won't resolve without it.

    Priority:
      1. The user's persisted UI default, if still present in the registry.
      2. Anthropic, if configured.
      3. The first available model.

    No paid-tier filter: custom-endpoint models carry no pricing, so filtering
    on ``pricing`` would discard perfectly good models and pick an arbitrary
    (possibly unrouteable) one instead.
    """
    full_models = registry._full_models
    if not full_models:
        return None, None

    # 1. Persisted UI default — honor it only if the model still exists.
    if settings.default_model:
        hit = registry.resolve_model(
            settings.default_model,
            settings.default_provider_id or None,
        )
        if hit:
            provider, model = hit
            return model.id, provider.id

    # 2. Anthropic first, when available.
    for provider, model in full_models:
        if model.provider_id == "anthropic":
            return model.id, provider.id

    # 3. First available model.
    provider, model = full_models[0]
    return model.id, provider.id
