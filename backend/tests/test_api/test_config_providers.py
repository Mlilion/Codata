"""Tests for provider configuration endpoints."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.schemas.agent import AgentInfo
from app.tool.builtin.vimax_generate_video import ViMaxGenerateVideoTool
from app.tool.context import ToolContext

pytestmark = pytest.mark.asyncio


def _tool_ctx() -> ToolContext:
    ctx = ToolContext(
        session_id="test-session",
        message_id="test-message",
        agent=AgentInfo(name="test", description="", mode="primary"),
        call_id="test-call",
    )
    ctx._provider_id = "openrouter"  # type: ignore[attr-defined]
    ctx._model_id = "google/gemini-test"  # type: ignore[attr-defined]
    return ctx


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
        update_env.assert_any_call("WORKCRAFT_DISABLED_PROVIDERS", "xiaomi")

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


class TestViMaxMediaConfig:
    async def test_get_vimax_media_config_reports_reserved_baoyu_adapter(self, app_client):
        settings = app_client.app.state.settings
        settings.vimax_media_api_key = "sk-media-test"
        settings.vimax_media_preset = "doubao"

        resp = await app_client.get("/api/config/vimax-media")

        assert resp.status_code == 200
        data = resp.json()
        assert data["preset"] == "doubao"
        assert data["ready"] is True
        assert data["has_api_key"] is True
        assert data["masked_api_key"] == "sk-medi...test"
        assert data["base_url"] == "https://yunwu.ai"
        assert data["image_model"] == "doubao-seedream-4-0-250828"
        assert data["video_model"] == "doubao-seedance-1-0-lite-i2v-250428"
        assert [item["id"] for item in data["presets"]] == ["doubao"]
        assert any(item["tool_id"] == "vimax_generate_video" and item["adapter_status"] == "active" for item in data["compatible_tools"])
        assert any(item["tool_id"] == "baoyu_image_generate" and item["adapter_status"] == "reserved" for item in data["compatible_tools"])

    async def test_patch_vimax_media_config_persists_runtime_settings(self, app_client):
        settings = app_client.app.state.settings

        with patch("app.api.config._update_env_file") as update_env:
            resp = await app_client.patch(
                "/api/config/vimax-media",
                json={
                    "preset": "doubao",
                    "api_key": "sk-new-media",
                    "base_url": "https://cloud.dataeyes.ai/v1",
                    "image_model": "doubao-seedream-custom",
                    "video_model": "doubao-seedance-custom-i2v",
                    "video_t2v_model": "doubao-seedance-custom-t2v",
                    "image_api_version": "",
                    "video_api_version": "",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["preset"] == "doubao"
        assert data["base_url"] == "https://yunwu.ai"
        assert data["image_model"] == "doubao-seedream-custom"
        assert data["video_model"] == "doubao-seedance-custom-i2v"
        assert data["video_t2v_model"] == "doubao-seedance-custom-t2v"
        assert settings.vimax_media_preset == "doubao"
        assert settings.vimax_media_api_key == "sk-new-media"
        assert settings.vimax_media_base_url == ""
        update_env.assert_any_call("WORKCRAFT_VIMAX_MEDIA_PRESET", "doubao")
        update_env.assert_any_call("WORKCRAFT_VIMAX_MEDIA_API_KEY", "sk-new-media")

    async def test_saved_vimax_media_config_is_used_by_video_tool(self, app_client):
        settings = app_client.app.state.settings
        settings.vimax_config_path = "/tmp/vimax.yaml"

        with patch("app.api.config._update_env_file"):
            resp = await app_client.patch(
                "/api/config/vimax-media",
                json={
                    "preset": "doubao",
                    "api_key": "sk-runtime-media",
                    "image_model": "doubao-seedream-runtime",
                    "video_model": "doubao-seedance-runtime-i2v",
                    "video_t2v_model": "doubao-seedance-runtime-t2v",
                    "video_ff2v_model": "doubao-seedance-runtime-i2v",
                    "video_flf2v_model": "doubao-seedance-runtime-i2v",
                },
            )

        assert resp.status_code == 200
        payload = ViMaxGenerateVideoTool()._build_submit_payload(
            {
                "mode": "script2video",
                "script": "INT. TEST - DAY",
            },
            _tool_ctx(),
        )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["image_generator"]["class_path"] == "tools.ImageGeneratorDoubaoSeedreamYunwuAPI"
        assert overrides["image_generator"]["init_args"] == {
            "api_key": "sk-runtime-media",
            "model": "doubao-seedream-runtime",
        }
        assert overrides["video_generator"]["class_path"] == "tools.VideoGeneratorDoubaoSeedanceYunwuAPI"
        assert overrides["video_generator"]["init_args"] == {
            "api_key": "sk-runtime-media",
            "t2v_model": "doubao-seedance-runtime-t2v",
            "ff2v_model": "doubao-seedance-runtime-i2v",
            "flf2v_model": "doubao-seedance-runtime-i2v",
        }

    async def test_dataeyes_vimax_media_config_is_exposed_and_used_by_video_tool(self, app_client):
        settings = app_client.app.state.settings
        settings.vimax_config_path = "/tmp/vimax.yaml"

        initial = await app_client.get("/api/config/vimax-media")
        assert initial.status_code == 200
        assert not any(item["id"] == "dataeyes" for item in initial.json()["presets"])

        with patch("app.api.config._update_env_file"):
            resp = await app_client.patch(
                "/api/config/vimax-media",
                json={
                    "preset": "dataeyes",
                    "api_key": "sk-dataeyes-media",
                    "base_url": "https://cloud.dataeyes.ai",
                    "image_model": "doubao-seedream-runtime",
                    "video_model": "doubao-seedance-runtime-i2v",
                    "video_t2v_model": "doubao-seedance-runtime-t2v",
                    "video_ff2v_model": "doubao-seedance-runtime-i2v",
                    "video_flf2v_model": "doubao-seedance-runtime-i2v",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["preset"] == "dataeyes"
        assert data["base_url"] == "https://cloud.dataeyes.ai"
        assert data["image_model"] == "doubao-seedream-runtime"
        assert data["video_t2v_model"] == "doubao-seedance-runtime-t2v"

        payload = ViMaxGenerateVideoTool()._build_submit_payload(
            {
                "mode": "script2video",
                "script": "INT. TEST - DAY",
            },
            _tool_ctx(),
        )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["image_generator"]["class_path"] == "tools.ImageGeneratorDoubaoSeedreamDataEyesAPI"
        assert overrides["image_generator"]["init_args"] == {
            "api_key": "sk-dataeyes-media",
            "base_url": "https://cloud.dataeyes.ai",
            "api_version": "v1",
            "model": "doubao-seedream-runtime",
        }
        assert overrides["video_generator"]["class_path"] == "tools.VideoGeneratorDoubaoSeedanceDataEyesAPI"
        assert overrides["video_generator"]["init_args"] == {
            "api_key": "sk-dataeyes-media",
            "base_url": "https://cloud.dataeyes.ai",
            "api_version": "v1",
            "t2v_model": "doubao-seedance-runtime-t2v",
            "ff2v_model": "doubao-seedance-runtime-i2v",
            "flf2v_model": "doubao-seedance-runtime-i2v",
        }

    async def test_dataeyes_gemini_veo_vimax_media_config_is_exposed_and_used_by_video_tool(self, app_client):
        settings = app_client.app.state.settings
        settings.vimax_config_path = "/tmp/vimax.yaml"

        initial = await app_client.get("/api/config/vimax-media")
        assert initial.status_code == 200
        assert not any(item["id"] == "dataeyes_gemini_veo" for item in initial.json()["presets"])

        with patch("app.api.config._update_env_file"):
            resp = await app_client.patch(
                "/api/config/vimax-media",
                json={
                    "preset": "dataeyes_gemini_veo",
                    "api_key": "sk-dataeyes-media",
                    "base_url": "https://cloud.dataeyes.ai/v1",
                    "image_model": "gemini-2.5-flash-image",
                    "video_model": "veo-3.1-generate-preview",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["preset"] == "dataeyes_gemini_veo"
        assert data["base_url"] == "https://cloud.dataeyes.ai"
        assert data["image_api_version"] == "v1beta"
        assert data["video_api_version"] == "v1"

        payload = ViMaxGenerateVideoTool()._build_submit_payload(
            {
                "mode": "script2video",
                "script": "INT. TEST - DAY",
            },
            _tool_ctx(),
        )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["image_generator"]["class_path"] == "tools.ImageGeneratorNanobananaDataEyesAPI"
        assert overrides["image_generator"]["init_args"] == {
            "api_key": "sk-dataeyes-media",
            "base_url": "https://cloud.dataeyes.ai",
            "api_version": "v1beta",
            "model": "gemini-2.5-flash-image",
        }
        assert overrides["video_generator"]["class_path"] == "tools.VideoGeneratorVeoDataEyesAPI"
        assert overrides["video_generator"]["init_args"] == {
            "api_key": "sk-dataeyes-media",
            "base_url": "https://cloud.dataeyes.ai",
            "api_version": "v1",
            "t2v_model": "veo-3.1-generate-preview",
            "ff2v_model": "veo-3.1-generate-preview",
            "flf2v_model": "veo-3.1-generate-preview",
        }

    async def test_dataeyes_vimax_media_config_does_not_treat_yunwu_key_as_ready(self, app_client):
        settings = app_client.app.state.settings
        settings.vimax_media_preset = "dataeyes"
        settings.vimax_yunwu_api_key = "yunwu-key"
        settings.vimax_media_api_key = ""
        settings.custom_endpoints = "[]"

        resp = await app_client.get("/api/config/vimax-media")

        assert resp.status_code == 200
        data = resp.json()
        assert data["preset"] == "dataeyes"
        assert data["ready"] is False
        assert "api_key" in data["missing"]
