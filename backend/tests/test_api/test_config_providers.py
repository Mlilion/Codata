"""Tests for provider configuration endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
class TestToggleProvider:
    async def test_explicit_disable_is_idempotent(self, app_client):
        settings = app_client.app.state.settings
        registry = app_client.app.state.provider_registry
        settings.xiaomi_api_key = "sk-test"
        settings.disabled_providers = ""
        registry.get_provider.return_value = None

        with patch("app.api.config._update_env_file") as update_env:
            first = await app_client.post("/api/config/providers/xiaomi/toggle", json={"enabled": False})
            second = await app_client.post("/api/config/providers/xiaomi/toggle", json={"enabled": False})

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["enabled"] is False
        assert first.json()["status"] == "disabled"
        assert second.json()["enabled"] is False
        assert second.json()["status"] == "disabled"
        assert settings.disabled_providers == "xiaomi"
        assert registry.register.call_count == 0
        assert registry.refresh_models.await_count == 0
        assert registry.unregister.call_count == 2
        update_env.assert_any_call("CODATA_DISABLED_PROVIDERS", "xiaomi")

    async def test_empty_body_keeps_legacy_toggle_behavior(self, app_client):
        settings = app_client.app.state.settings
        registry = app_client.app.state.provider_registry
        settings.xiaomi_api_key = "sk-test"
        settings.disabled_providers = ""
        registry.get_provider.return_value = None

        with patch("app.api.config._update_env_file"):
            disabled = await app_client.post("/api/config/providers/xiaomi/toggle")
            enabled = await app_client.post("/api/config/providers/xiaomi/toggle")

        assert disabled.status_code == 200
        assert disabled.json()["enabled"] is False
        assert disabled.json()["status"] == "disabled"
        assert enabled.status_code == 200
        assert enabled.json()["enabled"] is True
        assert settings.disabled_providers == ""
        assert registry.register.call_count == 1
        assert registry.refresh_models.await_count == 1


class TestOpenAIFreeConfiguration:
    """The OpenAI provider endpoint is freely configurable — no company-
    specific default may be hardcoded anywhere."""

    def test_openai_base_url_has_no_default(self):
        from app.config import Settings

        # Static check on the model field: the shipped default must be empty
        # (catalog's api.openai.com applies), never a pre-wired gateway.
        assert Settings.model_fields["openai_base_url"].default == ""

    @pytest.mark.asyncio
    async def test_key_saved_with_configured_base_url(self, app_client):
        settings = app_client.app.state.settings
        registry = app_client.app.state.provider_registry
        settings.openai_api_key = ""
        settings.openai_base_url = "https://my-gateway.example/v1"

        with (
            patch(
                "app.api.config._validate_provider_connection",
                new=AsyncMock(return_value=(2, [])),
            ) as validate,
            patch("app.api.config._update_env_file") as update_env,
        ):
            resp = await app_client.post(
                "/api/config/providers/openai/key",
                json={"api_key": "sk-test-openai"},
            )

        assert resp.status_code == 200
        # The user-configured endpoint must be used for validation ...
        validate.assert_awaited_once()
        assert validate.await_args.kwargs.get("base_url") == "https://my-gateway.example/v1"
        # ... and for the registered provider.
        registry.register.assert_called_once()
        assert resp.json()["base_url"] == "https://my-gateway.example/v1"
        # Persisted so headless restarts keep the free configuration.
        update_env.assert_any_call("CODATA_OPENAI_BASE_URL", "https://my-gateway.example/v1")

    @pytest.mark.asyncio
    async def test_key_saved_without_base_url_keeps_catalog_default(self, app_client):
        settings = app_client.app.state.settings
        registry = app_client.app.state.provider_registry
        settings.openai_api_key = ""
        settings.openai_base_url = ""

        with (
            patch(
                "app.api.config._validate_provider_connection",
                new=AsyncMock(return_value=(2, [])),
            ) as validate,
            patch("app.api.config._update_env_file"),
        ):
            resp = await app_client.post(
                "/api/config/providers/openai/key",
                json={"api_key": "sk-test-openai"},
            )

        assert resp.status_code == 200
        # No override → catalog default (api.openai.com), no base_url kwarg.
        validate.assert_awaited_once()
        assert "base_url" not in validate.await_args.kwargs
        assert resp.json()["base_url"] is None

    @pytest.mark.asyncio
    async def test_explicit_body_base_url_wins_and_persists(self, app_client):
        settings = app_client.app.state.settings
        settings.openai_api_key = ""
        settings.openai_base_url = ""

        with (
            patch(
                "app.api.config._validate_provider_connection",
                new=AsyncMock(return_value=(2, [])),
            ) as validate,
            patch("app.api.config._update_env_file") as update_env,
        ):
            resp = await app_client.post(
                "/api/config/providers/openai/key",
                json={"api_key": "sk-test-openai", "base_url": "https://other.example/v1"},
            )

        assert resp.status_code == 200
        assert validate.await_args.kwargs.get("base_url") == "https://other.example/v1"
        assert settings.openai_base_url == "https://other.example/v1"
        update_env.assert_any_call("CODATA_OPENAI_BASE_URL", "https://other.example/v1")


class TestDoubaoProviderConfiguration:
    def test_doubao_provider_is_openai_compatible(self):
        from app.config import Settings
        from app.provider.catalog import PROVIDER_CATALOG

        provider = PROVIDER_CATALOG["doubao"]

        assert provider.settings_key == "doubao_api_key"
        assert provider.base_url == "https://ark.cn-beijing.volces.com/api/v3"
        assert Settings.model_fields["doubao_api_key"].default == ""

