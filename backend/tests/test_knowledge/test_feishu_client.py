from __future__ import annotations
from app.knowledge import feishu_client
from app.channels.config import ChannelsConfig

def test_load_credentials_present(monkeypatch):
    cfg = ChannelsConfig(channels={"feishu": {"app_id": "cli_x", "app_secret": "sec", "domain": "feishu"}})
    monkeypatch.setattr(feishu_client, "load_channels_config", lambda: cfg)
    assert feishu_client.load_feishu_credentials() == ("cli_x", "sec", "feishu")

def test_load_credentials_missing(monkeypatch):
    monkeypatch.setattr(feishu_client, "load_channels_config", lambda: ChannelsConfig(channels={}))
    assert feishu_client.load_feishu_credentials() is None

def test_load_credentials_partial(monkeypatch):
    cfg = ChannelsConfig(channels={"feishu": {"app_id": "cli_x"}})  # no secret
    monkeypatch.setattr(feishu_client, "load_channels_config", lambda: cfg)
    assert feishu_client.load_feishu_credentials() is None

def test_build_client_returns_object(monkeypatch):
    c = feishu_client.build_lark_client("cli_x", "sec", "feishu")
    assert c is not None  # lark_oapi.Client instance
