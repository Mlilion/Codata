"""Tests for provider configuration endpoints."""

from __future__ import annotations

from unittest.mock import patch

import pytest

pytestmark = pytest.mark.asyncio


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


