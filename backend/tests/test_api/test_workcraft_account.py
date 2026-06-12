"""Tests for WorkCraft account provider sync."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.api.config import (
    Sub2APIForgotPasswordRequest,
    Sub2APIResetPasswordRequest,
    WorkCraftAccountConnect,
    connect_workcraft_account,
    proxy_auth_forgot_password,
    proxy_auth_reset_password,
)

pytestmark = pytest.mark.asyncio


def _http_status_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://proxy.test/v1/models")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError(str(status_code), request=request, response=response)


def _settings():
    settings = MagicMock()
    settings.proxy_url = ""
    settings.proxy_token = ""
    settings.proxy_refresh_token = ""
    return settings


class TestConnectWorkCraftAccount:
    async def test_refreshes_expired_access_token_before_registering_proxy(self):
        settings = _settings()
        registry = MagicMock()
        registry.refresh_models = AsyncMock(return_value={})
        created_tokens: list[str] = []

        class FakeGenericOpenAIProvider:
            def __init__(self, api_key: str, **_kwargs):
                self.api_key = api_key
                self._api_key = api_key
                created_tokens.append(api_key)

            async def list_models(self):
                if self.api_key == "expired_access":
                    raise _http_status_error(401)
                return [object()]

        body = WorkCraftAccountConnect(
            proxy_url="https://proxy.test",
            token="expired_access",
            refresh_token="refresh_token",
        )

        with patch("app.provider.generic_openai.GenericOpenAIProvider", FakeGenericOpenAIProvider):
            with patch(
                "app.api.config._refresh_workcraft_proxy_token",
                AsyncMock(return_value=("fresh_access", "fresh_refresh")),
            ):
                with patch("app.api.config._update_env_file") as update_env:
                    status = await connect_workcraft_account(settings, registry, body)

        assert status.is_connected is True
        assert settings.proxy_url == "https://proxy.test"
        assert settings.proxy_token == "fresh_access"
        assert settings.proxy_refresh_token == "fresh_refresh"
        assert created_tokens == ["expired_access", "fresh_access", "fresh_access"]
        registered_provider = registry.register.call_args.args[0]
        assert registered_provider.api_key == "fresh_access"
        update_env.assert_any_call("WORKCRAFT_PROXY_TOKEN", "fresh_access")
        update_env.assert_any_call("WORKCRAFT_PROXY_REFRESH_TOKEN", "fresh_refresh")


class TestSub2APIAuthProxy:
    async def test_proxy_forgot_password_forwards_email(self):
        calls: list[dict] = []

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def post(self, url, json, timeout):
                calls.append({"url": url, "json": json, "timeout": timeout})
                return httpx.Response(
                    200,
                    json={"code": 0, "message": "ok", "data": {"message": "sent"}},
                    request=httpx.Request("POST", url),
                )

        with patch("app.api.config.httpx.AsyncClient", return_value=FakeClient()):
            result = await proxy_auth_forgot_password(Sub2APIForgotPasswordRequest(email="user@example.com"))

        assert result == {"message": "sent"}
        assert calls == [
            {
                "url": "https://aihub2.top/api/v1/auth/forgot-password",
                "json": {"email": "user@example.com"},
                "timeout": 15.0,
            },
        ]

    async def test_proxy_reset_password_forwards_token_and_new_password(self):
        calls: list[dict] = []

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def post(self, url, json, timeout):
                calls.append({"url": url, "json": json, "timeout": timeout})
                return httpx.Response(
                    200,
                    json={"code": 0, "message": "ok", "data": {"message": "reset"}},
                    request=httpx.Request("POST", url),
                )

        with patch("app.api.config.httpx.AsyncClient", return_value=FakeClient()):
            result = await proxy_auth_reset_password(
                Sub2APIResetPasswordRequest(
                    email="user@example.com",
                    token="reset-token",
                    new_password="new-password",
                )
            )

        assert result == {"message": "reset"}
        assert calls == [
            {
                "url": "https://aihub2.top/api/v1/auth/reset-password",
                "json": {
                    "email": "user@example.com",
                    "token": "reset-token",
                    "new_password": "new-password",
                },
                "timeout": 15.0,
            },
        ]
