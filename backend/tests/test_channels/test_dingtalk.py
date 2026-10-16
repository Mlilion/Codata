"""Tests for DingTalk channel dependency wiring."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api import channels as channels_api
from app.channels.config import load_channels_config, resolve_channels_config_path
from app.channels.registry import SUPPORTED_CHANNELS, discover_channel_names, load_channel_class

pytestmark = pytest.mark.asyncio


async def test_dingtalk_stream_sdk_is_available():
    from app.channels.dingtalk import DINGTALK_AVAILABLE, DingTalkChannel

    assert DINGTALK_AVAILABLE is True
    assert load_channel_class("dingtalk") is DingTalkChannel


async def test_registry_discovers_only_supported_channels():
    assert set(discover_channel_names()) == SUPPORTED_CHANNELS


async def test_load_channel_class_rejects_removed_channel():
    with pytest.raises(ImportError, match="Unsupported channel"):
        load_channel_class("slack")


async def test_add_dingtalk_channel_requires_client_credentials(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/channels/add", json={"channel": "dingtalk", "token": "old-token"})

    assert response.status_code == 400
    assert response.json()["detail"] == "DingTalk requires client_id and client_secret"
    assert not config_path.exists()


async def test_add_removed_channel_is_rejected(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/channels/add", json={"channel": "slack"})

    assert response.status_code == 400
    assert response.json()["detail"].startswith("Unsupported channel: slack")
    assert not config_path.exists()


async def test_add_wecom_channel_requires_bot_credentials(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/channels/add", json={"channel": "wecom", "token": "old-token"})

    assert response.status_code == 400
    assert response.json()["detail"] == "WeCom requires bot_id and secret"
    assert not config_path.exists()


async def test_add_wecom_channel_saves_bot_credentials(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/channels/add",
            json={
                "channel": "wecom",
                "bot_id": "wecom-bot-id",
                "secret": "wecom-secret",
                "welcome_message": "hello",
            },
        )

    assert response.status_code == 200
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["channels"]["wecom"]["enabled"] is True
    assert saved["channels"]["wecom"]["bot_id"] == "wecom-bot-id"
    assert saved["channels"]["wecom"]["secret"] == "wecom-secret"
    assert saved["channels"]["wecom"]["welcome_message"] == "hello"


async def test_add_qq_channel_saves_app_credentials(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/channels/add",
            json={
                "channel": "qq",
                "app_id": "qq-app-id",
                "secret": "qq-secret",
            },
        )

    assert response.status_code == 200
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["channels"]["qq"]["enabled"] is True
    assert saved["channels"]["qq"]["app_id"] == "qq-app-id"
    assert saved["channels"]["qq"]["secret"] == "qq-secret"


async def test_list_channels_filters_removed_channels(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)
    config_path.write_text(
        json.dumps(
            {
                "channels": {
                    "telegram": {"enabled": True, "token": "telegram-token"},
                    "slack": {"enabled": True, "bot_token": "xoxb", "app_token": "xapp"},
                }
            }
        ),
        encoding="utf-8",
    )

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/channels")

    assert response.status_code == 200
    assert set(response.json()["channels"]) == {"telegram"}


async def test_add_dingtalk_channel_saves_client_credentials(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/channels/add",
            json={
                "channel": "dingtalk",
                "client_id": "ding-client-id",
                "client_secret": "ding-client-secret",
            },
        )

    assert response.status_code == 200
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["channels"]["dingtalk"]["enabled"] is True
    assert saved["channels"]["dingtalk"]["allow_from"] == ["*"]
    assert saved["channels"]["dingtalk"]["client_id"] == "ding-client-id"
    assert saved["channels"]["dingtalk"]["client_secret"] == "ding-client-secret"


async def test_default_api_config_path_matches_startup_loader(monkeypatch, tmp_path: Path):
    monkeypatch.chdir(tmp_path)

    channels_api._save_config_dict(
        {
            "channels": {
                "dingtalk": {
                    "enabled": True,
                    "client_id": "ding-client-id",
                    "client_secret": "ding-client-secret",
                }
            }
        }
    )

    config = load_channels_config(resolve_channels_config_path(""))
    assert config.channels["dingtalk"]["client_id"] == "ding-client-id"


async def test_remove_dingtalk_channel_disables_but_preserves_credentials(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)
    config_path.write_text(
        json.dumps(
            {
                "channels": {
                    "dingtalk": {
                        "enabled": True,
                        "allow_from": ["*"],
                        "client_id": "ding-client-id",
                        "client_secret": "ding-client-secret",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/channels/remove", json={"channel": "dingtalk"})

    assert response.status_code == 200
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["channels"]["dingtalk"]["enabled"] is False
    assert saved["channels"]["dingtalk"]["client_id"] == "ding-client-id"
    assert saved["channels"]["dingtalk"]["client_secret"] == "ding-client-secret"


async def test_add_dingtalk_channel_reuses_saved_credentials(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)
    config_path.write_text(
        json.dumps(
            {
                "channels": {
                    "dingtalk": {
                        "enabled": False,
                        "allow_from": ["021711153920502150"],
                        "client_id": "ding-client-id",
                        "client_secret": "ding-client-secret",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/channels/add", json={"channel": "dingtalk"})

    assert response.status_code == 200
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["channels"]["dingtalk"]["enabled"] is True
    assert saved["channels"]["dingtalk"]["allow_from"] == ["021711153920502150"]
    assert saved["channels"]["dingtalk"]["client_id"] == "ding-client-id"
    assert saved["channels"]["dingtalk"]["client_secret"] == "ding-client-secret"


async def test_add_dingtalk_channel_rejects_config_update_while_running(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)
    config_path.write_text(
        json.dumps(
            {
                "channels": {
                    "dingtalk": {
                        "enabled": True,
                        "client_id": "ding-client-id",
                        "client_secret": "ding-client-secret",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    class RunningManager:
        def get_status(self):
            return {"dingtalk": {"enabled": True, "running": True}}

    app = FastAPI()
    app.state.channel_manager = RunningManager()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/channels/add",
            json={
                "channel": "dingtalk",
                "client_id": "new-client-id",
                "client_secret": "new-client-secret",
            },
        )

    assert response.status_code == 409
    assert response.json()["detail"] == "Disconnect the channel before modifying its configuration"
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["channels"]["dingtalk"]["client_id"] == "ding-client-id"


async def test_add_dingtalk_channel_is_idempotent_when_running_without_config_update(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)
    config_path.write_text(
        json.dumps(
            {
                "channels": {
                    "dingtalk": {
                        "enabled": True,
                        "client_id": "ding-client-id",
                        "client_secret": "ding-client-secret",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    class RunningManager:
        def get_status(self):
            return {"dingtalk": {"enabled": True, "running": True}}

    app = FastAPI()
    app.state.channel_manager = RunningManager()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/channels/add", json={"channel": "dingtalk"})

    assert response.status_code == 200
    assert response.json()["message"] == "dingtalk channel already running"


async def test_start_weixin_qr_login_creates_session(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)

    async def fake_weixin_api_get(**kwargs):
        assert kwargs["endpoint"] == "ilink/bot/get_bot_qrcode"
        assert kwargs["base_url"] == "https://ilink.example.com"
        return {
            "qrcode": "qr-1",
            "qrcode_img_content": "https://scan.example.com/qr-1",
        }

    monkeypatch.setattr(channels_api, "_weixin_api_get", fake_weixin_api_get)

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/channels/weixin/qr/start",
            json={"base_url": "https://ilink.example.com", "route_tag": "dev"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["scan_url"] == "https://scan.example.com/qr-1"
    assert payload["status"] == "waiting_scan"

    sessions = app.state.weixin_qr_sessions
    session = sessions[payload["session_id"]]
    assert session["qrcode_id"] == "qr-1"
    assert session["route_tag"] == "dev"


async def test_weixin_qr_confirmation_saves_token_and_starts_channel(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)

    async def fake_weixin_api_get(**kwargs):
        if kwargs["endpoint"] == "ilink/bot/get_bot_qrcode":
            return {
                "qrcode": "qr-1",
                "qrcode_img_content": "https://scan.example.com/qr-1",
            }
        assert kwargs["endpoint"] == "ilink/bot/get_qrcode_status"
        return {
            "status": "confirmed",
            "bot_token": "weixin-token",
            "ilink_bot_id": "bot-1",
            "ilink_user_id": "user-1",
            "baseurl": "https://redirect.weixin.example.com",
        }

    started: list[tuple[str, dict]] = []

    async def fake_start_configured_channel(request, channel_name, channel_config):
        started.append((channel_name, channel_config))
        return "weixin channel added and started"

    monkeypatch.setattr(channels_api, "_weixin_api_get", fake_weixin_api_get)
    monkeypatch.setattr(channels_api, "_start_configured_channel", fake_start_configured_channel)

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        start_response = await client.post("/api/channels/weixin/qr/start", json={})
        session_id = start_response.json()["session_id"]
        status_response = await client.get(f"/api/channels/weixin/qr/{session_id}")

    assert status_response.status_code == 200
    assert status_response.json()["status"] == "confirmed"
    assert status_response.json()["account"] == "user-1"

    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["channels"]["weixin"]["enabled"] is True
    assert saved["channels"]["weixin"]["token"] == "weixin-token"
    assert saved["channels"]["weixin"]["account"] == "user-1"
    assert saved["channels"]["weixin"]["bot_id"] == "bot-1"
    assert saved["channels"]["weixin"]["base_url"] == "https://redirect.weixin.example.com"
    assert started[0][0] == "weixin"
    assert started[0][1]["token"] == "weixin-token"


async def test_start_feishu_qr_registration_creates_session(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)

    async def fake_feishu_registration_request(**kwargs):
        assert kwargs["base_url"] == "https://accounts.feishu.cn"
        assert kwargs["params"]["action"] == "begin"
        return {
            "verification_uri_complete": "https://accounts.feishu.cn/passport/device?user_code=ABCD",
            "device_code": "device-1",
            "expires_in": 600,
            "interval": 5,
        }

    monkeypatch.setattr(channels_api, "_feishu_registration_request", fake_feishu_registration_request)

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/channels/feishu/qr/start", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["scan_url"].startswith("https://accounts.feishu.cn/passport/device?")
    assert "source=node-sdk%2Fcodata" in payload["scan_url"]
    assert payload["status"] == "waiting_scan"

    sessions = app.state.feishu_qr_sessions
    session = sessions[payload["session_id"]]
    assert session["device_code"] == "device-1"
    assert session["interval"] == 5


async def test_feishu_qr_confirmation_saves_credentials_and_starts_channel(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "channels.json"
    monkeypatch.setattr(channels_api, "_get_channels_config_path", lambda request=None: config_path)

    async def fake_feishu_registration_request(**kwargs):
        if kwargs["params"]["action"] == "begin":
            return {
                "verification_uri_complete": "https://accounts.feishu.cn/passport/device?user_code=ABCD",
                "device_code": "device-1",
                "expires_in": 600,
                "interval": 5,
            }
        assert kwargs["params"]["action"] == "poll"
        assert kwargs["params"]["device_code"] == "device-1"
        return {
            "client_id": "cli_test",
            "client_secret": "feishu-secret",
            "user_info": {
                "open_id": "ou_test",
                "tenant_brand": "feishu",
            },
        }

    started: list[tuple[str, dict]] = []

    async def fake_start_configured_channel(request, channel_name, channel_config):
        started.append((channel_name, channel_config))
        return "feishu channel added and started"

    monkeypatch.setattr(channels_api, "_feishu_registration_request", fake_feishu_registration_request)
    monkeypatch.setattr(channels_api, "_start_configured_channel", fake_start_configured_channel)

    app = FastAPI()
    app.include_router(channels_api.router, prefix="/api")

    transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        start_response = await client.post("/api/channels/feishu/qr/start", json={})
        session_id = start_response.json()["session_id"]
        status_response = await client.get(f"/api/channels/feishu/qr/{session_id}")

    assert status_response.status_code == 200
    assert status_response.json()["status"] == "confirmed"
    assert status_response.json()["account"] == "ou_test"

    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["channels"]["feishu"]["enabled"] is True
    assert saved["channels"]["feishu"]["app_id"] == "cli_test"
    assert saved["channels"]["feishu"]["app_secret"] == "feishu-secret"
    assert saved["channels"]["feishu"]["account"] == "ou_test"
    assert saved["channels"]["feishu"]["domain"] == "feishu"
    assert started[0][0] == "feishu"
    assert started[0][1]["app_id"] == "cli_test"
