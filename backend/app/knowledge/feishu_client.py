"""Native lark_oapi client for the knowledge base — reuses the Feishu channel
credentials (app_id/secret/domain) so documents can be read via tenant token
without any external MCP process."""
from __future__ import annotations

from typing import Any

from app.channels.config import load_channels_config


def load_feishu_credentials() -> tuple[str, str, str] | None:
    cfg = load_channels_config()
    feishu = cfg.channels.get("feishu") or {}
    app_id = (feishu.get("app_id") or "").strip()
    app_secret = (feishu.get("app_secret") or "").strip()
    if not app_id or not app_secret:
        return None
    domain = (feishu.get("domain") or "feishu").strip() or "feishu"
    return app_id, app_secret, domain


def build_lark_client(app_id: str, app_secret: str, domain: str) -> Any:
    import lark_oapi as lark
    from lark_oapi.core.const import FEISHU_DOMAIN, LARK_DOMAIN

    dom = LARK_DOMAIN if domain == "lark" else FEISHU_DOMAIN
    return (
        lark.Client.builder()
        .app_id(app_id)
        .app_secret(app_secret)
        .domain(dom)
        .build()
    )


def get_feishu_client() -> Any | None:
    creds = load_feishu_credentials()
    if creds is None:
        return None
    return build_lark_client(*creds)
