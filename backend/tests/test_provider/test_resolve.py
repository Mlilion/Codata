"""Tests for the shared default-model resolver."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, PropertyMock

import pytest

from app.provider.registry import ProviderRegistry
from app.provider.resolve import resolve_default_model
from app.schemas.provider import ModelCapabilities, ModelInfo, ProviderStatus


def _make_provider(pid: str, models: list[ModelInfo] | None = None):
    p = MagicMock()
    type(p).id = PropertyMock(return_value=pid)
    p.list_models = AsyncMock(return_value=models or [])
    p.clear_cache = MagicMock()
    p.health_check = AsyncMock(
        return_value=ProviderStatus(status="connected", model_count=len(models or [])),
    )
    return p


def _model(mid: str, pid: str) -> ModelInfo:
    return ModelInfo(id=mid, name=mid, provider_id=pid, capabilities=ModelCapabilities())


def _settings(default_model: str = "", default_provider_id: str = "") -> MagicMock:
    s = MagicMock()
    s.default_model = default_model
    s.default_provider_id = default_provider_id
    return s


async def _registry(*providers) -> ProviderRegistry:
    reg = ProviderRegistry()
    for p in providers:
        reg.register(p)
    await reg.refresh_models()
    return reg


@pytest.mark.asyncio
async def test_prefers_persisted_default():
    reg = await _registry(
        _make_provider("custom_a", [_model("m1", "custom_a"), _model("m2", "custom_a")]),
    )
    model_id, provider_id = resolve_default_model(
        reg, _settings(default_model="m2", default_provider_id="custom_a"),
    )
    assert (model_id, provider_id) == ("m2", "custom_a")


@pytest.mark.asyncio
async def test_falls_back_when_default_missing():
    # Persisted default no longer in the registry → fall back, don't error.
    reg = await _registry(_make_provider("custom_a", [_model("m1", "custom_a")]))
    model_id, provider_id = resolve_default_model(
        reg, _settings(default_model="gone", default_provider_id="custom_a"),
    )
    assert model_id == "m1"
    assert provider_id == "custom_a"


@pytest.mark.asyncio
async def test_empty_registry_returns_none():
    reg = await _registry()
    assert resolve_default_model(reg, _settings()) == (None, None)


@pytest.mark.asyncio
async def test_no_paid_model_still_resolves_real_model():
    # Regression: custom-endpoint models have no pricing. The old paid-tier
    # filter matched nothing and picked an arbitrary (unrouteable) model.
    reg = await _registry(
        _make_provider("custom_a", [_model("good-model", "custom_a")]),
    )
    model_id, provider_id = resolve_default_model(reg, _settings())
    assert model_id == "good-model"
    assert provider_id == "custom_a"


@pytest.mark.asyncio
async def test_anthropic_preferred_in_fallback():
    reg = await _registry(
        _make_provider("custom_a", [_model("m1", "custom_a")]),
        _make_provider("anthropic", [_model("claude-x", "anthropic")]),
    )
    model_id, provider_id = resolve_default_model(reg, _settings())
    assert provider_id == "anthropic"
    assert model_id == "claude-x"
