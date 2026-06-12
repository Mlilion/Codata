"""Channels API — manage in-process messaging platform channels.

Replaces the old OpenClaw-based system with nanobot's native channel
architecture running directly inside WorkCraft (no external Node.js process).
"""

from __future__ import annotations

import json
import logging
import base64
import os
import time
import uuid
from pathlib import Path
from typing import Any, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.channels.config import resolve_channels_config_path
from app.channels.registry import SUPPORTED_CHANNELS
from app.channels.weixin import ILINK_APP_CLIENT_VERSION, ILINK_APP_ID

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ChannelSystemStatus(BaseModel):
    """Status of the in-process channel system."""
    running: bool
    channels: dict[str, Any]


class ChannelAddRequest(BaseModel):
    channel: str
    allow_from: list[str] | None = None

    token: str | None = None
    app_id: str | None = None
    app_secret: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    secret: str | None = None
    bot_id: str | None = None
    base_url: str | None = None
    route_tag: str | None = None
    verification_token: str | None = None
    encrypt_key: str | None = None
    welcome_message: str | None = None
    streaming: bool = False
    extra: dict[str, Any] | None = None


class ChannelRemoveRequest(BaseModel):
    channel: str


class ChannelLoginRequest(BaseModel):
    channel: str = "weixin"


class WeixinQrStartRequest(BaseModel):
    base_url: str | None = None
    route_tag: str | int | None = None
    allow_from: list[str] | None = None


class WeixinQrStartResponse(BaseModel):
    session_id: str
    scan_url: str
    expires_at: float
    status: Literal["waiting_scan"] = "waiting_scan"


class WeixinQrStatusResponse(BaseModel):
    session_id: str
    status: Literal["waiting_scan", "scanned", "confirmed", "expired", "error"]
    message: str | None = None
    account: str | None = None
    expires_at: float | None = None


class FeishuQrStartRequest(BaseModel):
    allow_from: list[str] | None = None


class FeishuQrStartResponse(BaseModel):
    session_id: str
    scan_url: str
    expires_at: float
    status: Literal["waiting_scan"] = "waiting_scan"


class FeishuQrStatusResponse(BaseModel):
    session_id: str
    status: Literal["waiting_scan", "confirmed", "expired", "error"]
    message: str | None = None
    account: str | None = None
    expires_at: float | None = None
    provider_status: Literal["polling", "slow_down", "domain_switched"] | None = None
    interval: int | None = None


_CHANNEL_CONFIG_UPDATE_FIELDS = frozenset(
    {
        "allow_from",
        "token",
        "app_id",
        "app_secret",
        "client_id",
        "client_secret",
        "secret",
        "bot_id",
        "base_url",
        "route_tag",
        "verification_token",
        "encrypt_key",
        "welcome_message",
        "streaming",
        "extra",
    }
)

_WEIXIN_DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com"
_WEIXIN_QR_SESSION_TTL_S = 5 * 60
_FEISHU_DEFAULT_ACCOUNTS_BASE_URL = "https://accounts.feishu.cn"
_FEISHU_DEFAULT_LARK_ACCOUNTS_BASE_URL = "https://accounts.larksuite.com"
_FEISHU_REGISTRATION_ENDPOINT = "/oauth/v1/app/registration"
_FEISHU_QR_SOURCE = "workcraft"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_channel_manager(request: Request):
    """Get the ChannelManager from app state."""
    return getattr(request.app.state, "channel_manager", None)


def _get_channels_config_path(request: Request | None = None) -> Path:
    if request is not None:
        state_path = getattr(request.app.state, "channels_config_path", None)
        if state_path:
            return Path(state_path)
        settings = getattr(request.app.state, "settings", None)
        if settings is not None:
            return resolve_channels_config_path(getattr(settings, "channels_config_path", ""))
    return resolve_channels_config_path()


def _load_config_dict(request: Request | None = None) -> dict:
    """Load raw channels.json config."""
    path = _get_channels_config_path(request)
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"channels": {}}


def _save_config_dict(data: dict, request: Request | None = None) -> None:
    """Save raw channels.json config."""
    path = _get_channels_config_path(request)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _require_supported_channel(channel: str) -> None:
    if channel not in SUPPORTED_CHANNELS:
        supported = ", ".join(sorted(SUPPORTED_CHANNELS))
        raise HTTPException(
            400,
            f"Unsupported channel: {channel}. Supported channels: {supported}",
        )


def _get_weixin_qr_sessions(request: Request) -> dict[str, dict[str, Any]]:
    sessions = getattr(request.app.state, "weixin_qr_sessions", None)
    if sessions is None:
        sessions = {}
        request.app.state.weixin_qr_sessions = sessions
    return sessions


def _cleanup_weixin_qr_sessions(request: Request) -> None:
    sessions = _get_weixin_qr_sessions(request)
    now = time.time()
    expired = [
        session_id
        for session_id, session in sessions.items()
        if float(session.get("expires_at", 0)) <= now
    ]
    for session_id in expired:
        sessions.pop(session_id, None)


def _get_feishu_qr_sessions(request: Request) -> dict[str, dict[str, Any]]:
    sessions = getattr(request.app.state, "feishu_qr_sessions", None)
    if sessions is None:
        sessions = {}
        request.app.state.feishu_qr_sessions = sessions
    return sessions


def _cleanup_feishu_qr_sessions(request: Request) -> None:
    sessions = _get_feishu_qr_sessions(request)
    now = time.time()
    expired = [
        session_id
        for session_id, session in sessions.items()
        if float(session.get("expires_at", 0)) <= now
    ]
    for session_id in expired:
        sessions.pop(session_id, None)


def _weixin_headers(route_tag: str | int | None = None) -> dict[str, str]:
    uint32 = int.from_bytes(os.urandom(4), "big")
    wechat_uin = base64.b64encode(str(uint32).encode()).decode()
    headers = {
        "X-WECHAT-UIN": wechat_uin,
        "Content-Type": "application/json",
        "AuthorizationType": "ilink_bot_token",
        "iLink-App-Id": ILINK_APP_ID,
        "iLink-App-ClientVersion": str(ILINK_APP_CLIENT_VERSION),
    }
    if route_tag is not None and str(route_tag).strip():
        headers["SKRouteTag"] = str(route_tag).strip()
    return headers


async def _weixin_api_get(
    *,
    base_url: str,
    endpoint: str,
    params: dict[str, Any] | None = None,
    route_tag: str | int | None = None,
) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/{endpoint}"
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30, connect=10),
        follow_redirects=True,
    ) as client:
        resp = await client.get(url, params=params, headers=_weixin_headers(route_tag))
        resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, dict):
        raise RuntimeError("Unexpected WeChat API response")
    return data


def _int_or_default(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _feishu_registration_qr_url(url: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update(
        {
            "from": "sdk",
            "source": f"node-sdk/{_FEISHU_QR_SOURCE}",
            "tp": "sdk",
        }
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


async def _feishu_registration_request(
    *,
    base_url: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}{_FEISHU_REGISTRATION_ENDPOINT}"
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30, connect=10),
        follow_redirects=True,
    ) as client:
        resp = await client.post(
            url,
            data={key: str(value) for key, value in params.items()},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.status_code >= 400:
            try:
                data = resp.json()
            except Exception:
                resp.raise_for_status()
            if resp.status_code == 400 and isinstance(data, dict):
                return data
            resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, dict):
        raise RuntimeError("Unexpected Feishu registration response")
    return data


async def _start_configured_channel(
    request: Request,
    channel_name: str,
    channel_config: dict[str, Any],
) -> str:
    mgr = _get_channel_manager(request)
    if mgr is None:
        return f"{channel_name} configured (will start on restart)"

    try:
        from app.channels.registry import load_channel_class

        cls = load_channel_class(channel_name)
        channel_instance = cls(channel_config, mgr.bus)
        await mgr.add_and_start_channel(channel_name, channel_instance)
        logger.info("Channel %s added and started", channel_name)
        return f"{channel_name} channel added and started"
    except Exception as e:
        logger.warning("Channel %s configured but failed to start: %s", channel_name, e)
        return f"{channel_name} configured (will start on restart): {e}"


# ---------------------------------------------------------------------------
# Channel System Status
# ---------------------------------------------------------------------------

@router.get("/channels/status")
async def channels_status(request: Request) -> ChannelSystemStatus:
    """Get status of the in-process channel system."""
    mgr = _get_channel_manager(request)
    if mgr is None:
        return ChannelSystemStatus(running=False, channels={})

    return ChannelSystemStatus(
        running=bool(mgr.enabled_channels),
        channels=mgr.get_status(),
    )


# ---------------------------------------------------------------------------
# Channel CRUD
# ---------------------------------------------------------------------------

@router.get("/channels")
async def list_channels(request: Request) -> dict:
    """List all configured channels and their status."""
    mgr = _get_channel_manager(request)
    running_channels = mgr.get_status() if mgr else {}

    # Also include configured-but-not-running channels from config
    config = _load_config_dict(request)
    all_channels: dict[str, Any] = {}

    for name, ch_config in config.get("channels", {}).items():
        if name not in SUPPORTED_CHANNELS:
            continue
        enabled = ch_config.get("enabled", False)
        is_running = name in running_channels and running_channels[name].get("running", False)
        all_channels[name] = {
            "id": name,
            "name": name.capitalize(),
            "status": "running" if is_running else ("configured" if enabled else "disabled"),
            "type": name,
            "account": ch_config.get("account") or ch_config.get("user_id") or ch_config.get("bot_id"),
        }

    return {
        "channels": all_channels,
        "gateway_running": bool(running_channels),
    }


@router.post("/channels/add")
async def add_channel(request: Request, body: ChannelAddRequest) -> dict:
    """Add and enable a messaging channel.

    Saves config and starts the channel immediately if possible.
    """
    _require_supported_channel(body.channel)

    config = _load_config_dict(request)
    channels = config.setdefault("channels", {})
    existing = channels.get(body.channel, {})

    mgr = _get_channel_manager(request)
    running_channels = mgr.get_status() if mgr else {}
    is_running = body.channel in running_channels and running_channels[body.channel].get("running", False)
    has_config_update = bool(_CHANNEL_CONFIG_UPDATE_FIELDS & body.model_fields_set)
    if is_running and has_config_update:
        raise HTTPException(409, "Disconnect the channel before modifying its configuration")
    if is_running:
        return {"ok": True, "message": f"{body.channel} channel already running"}

    # Build channel config
    ch_config: dict[str, Any] = {
        "enabled": True,
        "allow_from": body.allow_from or existing.get("allow_from") or ["*"],
    }

    if body.channel == "telegram":
        token = body.token or existing.get("token")
        if not token:
            raise HTTPException(400, "Telegram requires a bot token")
        ch_config["token"] = token

    elif body.channel == "feishu":
        app_id = body.app_id or existing.get("app_id")
        app_secret = body.app_secret or existing.get("app_secret")
        if not app_id or not app_secret:
            raise HTTPException(400, "Feishu requires app_id and app_secret")
        ch_config["app_id"] = app_id
        ch_config["app_secret"] = app_secret
        if existing.get("domain"):
            ch_config["domain"] = existing["domain"]
        if body.verification_token is not None:
            ch_config["verification_token"] = body.verification_token
        elif existing.get("verification_token"):
            ch_config["verification_token"] = existing["verification_token"]
        if body.encrypt_key is not None:
            ch_config["encrypt_key"] = body.encrypt_key
        elif existing.get("encrypt_key"):
            ch_config["encrypt_key"] = existing["encrypt_key"]

    elif body.channel == "dingtalk":
        client_id = body.client_id or existing.get("client_id")
        client_secret = body.client_secret or existing.get("client_secret")
        if not client_id or not client_secret:
            raise HTTPException(400, "DingTalk requires client_id and client_secret")
        ch_config["client_id"] = client_id
        ch_config["client_secret"] = client_secret

    elif body.channel == "weixin":
        token = body.token or existing.get("token")
        if not token:
            raise HTTPException(400, "WeChat requires a bot token")
        ch_config["token"] = token
        if body.base_url is not None:
            ch_config["base_url"] = body.base_url
        elif existing.get("base_url"):
            ch_config["base_url"] = existing["base_url"]
        if body.route_tag is not None:
            ch_config["route_tag"] = body.route_tag
        elif existing.get("route_tag") is not None:
            ch_config["route_tag"] = existing["route_tag"]

    elif body.channel == "wecom":
        bot_id = body.bot_id or existing.get("bot_id")
        secret = body.secret or existing.get("secret")
        if not bot_id or not secret:
            raise HTTPException(400, "WeCom requires bot_id and secret")
        ch_config["bot_id"] = bot_id
        ch_config["secret"] = secret
        if body.welcome_message is not None:
            ch_config["welcome_message"] = body.welcome_message
        elif existing.get("welcome_message"):
            ch_config["welcome_message"] = existing["welcome_message"]

    elif body.channel == "qq":
        app_id = body.app_id or existing.get("app_id")
        secret = body.secret or existing.get("secret")
        if not app_id or not secret:
            raise HTTPException(400, "QQ requires app_id and secret")
        ch_config["app_id"] = app_id
        ch_config["secret"] = secret
    else:
        raise HTTPException(400, f"Unknown channel: {body.channel}")

    if body.extra:
        ch_config.update(body.extra)

    if body.streaming:
        ch_config["streaming"] = True

    # Merge with existing config (don't overwrite fields not provided)
    existing.update(ch_config)
    channels[body.channel] = existing

    _save_config_dict(config, request)

    message = await _start_configured_channel(request, body.channel, existing)
    return {"ok": True, "message": message}


@router.post("/channels/weixin/qr/start", response_model=WeixinQrStartResponse)
async def start_weixin_qr_login(request: Request, body: WeixinQrStartRequest) -> WeixinQrStartResponse:
    """Create a WeChat QR login session for browser-based configuration."""
    _require_supported_channel("weixin")

    mgr = _get_channel_manager(request)
    running_channels = mgr.get_status() if mgr else {}
    is_running = "weixin" in running_channels and running_channels["weixin"].get("running", False)
    if is_running:
        raise HTTPException(409, "Disconnect the channel before modifying its configuration")

    config = _load_config_dict(request)
    existing = config.get("channels", {}).get("weixin", {})
    base_url = (body.base_url or existing.get("base_url") or _WEIXIN_DEFAULT_BASE_URL).rstrip("/")
    route_tag = body.route_tag if body.route_tag is not None else existing.get("route_tag")

    try:
        data = await _weixin_api_get(
            base_url=base_url,
            endpoint="ilink/bot/get_bot_qrcode",
            params={"bot_type": "3"},
            route_tag=route_tag,
        )
    except Exception as e:
        logger.warning("Failed to create WeChat QR login session: %s", e)
        raise HTTPException(502, f"Failed to get WeChat QR code: {e}") from e

    qrcode_id = str(data.get("qrcode", "") or "").strip()
    scan_url = str(data.get("qrcode_img_content", "") or qrcode_id).strip()
    if not qrcode_id or not scan_url:
        raise HTTPException(502, "WeChat did not return a valid QR code")

    _cleanup_weixin_qr_sessions(request)
    session_id = uuid.uuid4().hex
    expires_at = time.time() + _WEIXIN_QR_SESSION_TTL_S
    _get_weixin_qr_sessions(request)[session_id] = {
        "qrcode_id": qrcode_id,
        "scan_url": scan_url,
        "base_url": base_url,
        "poll_base_url": base_url,
        "route_tag": route_tag,
        "allow_from": body.allow_from or existing.get("allow_from") or ["*"],
        "expires_at": expires_at,
    }

    return WeixinQrStartResponse(
        session_id=session_id,
        scan_url=scan_url,
        expires_at=expires_at,
    )


@router.get("/channels/weixin/qr/{session_id}", response_model=WeixinQrStatusResponse)
async def get_weixin_qr_login_status(request: Request, session_id: str) -> WeixinQrStatusResponse:
    """Poll a WeChat QR login session and save credentials once confirmed."""
    sessions = _get_weixin_qr_sessions(request)
    session = sessions.get(session_id)
    now = time.time()
    if not session:
        return WeixinQrStatusResponse(
            session_id=session_id,
            status="expired",
            message="QR login session expired",
        )
    if float(session.get("expires_at", 0)) <= now:
        sessions.pop(session_id, None)
        return WeixinQrStatusResponse(
            session_id=session_id,
            status="expired",
            message="QR code expired, please refresh",
        )

    try:
        status_data = await _weixin_api_get(
            base_url=str(session["poll_base_url"]),
            endpoint="ilink/bot/get_qrcode_status",
            params={"qrcode": session["qrcode_id"]},
            route_tag=session.get("route_tag"),
        )
    except Exception as e:
        logger.warning("Failed to poll WeChat QR login session %s: %s", session_id, e)
        return WeixinQrStatusResponse(
            session_id=session_id,
            status="error",
            message=str(e),
            expires_at=session.get("expires_at"),
        )

    status = str(status_data.get("status", "") or "")
    if status == "confirmed":
        token = str(status_data.get("bot_token", "") or "").strip()
        if not token:
            sessions.pop(session_id, None)
            return WeixinQrStatusResponse(
                session_id=session_id,
                status="error",
                message="Login confirmed but WeChat did not return a bot token",
            )

        account = str(status_data.get("ilink_user_id", "") or "").strip()
        bot_id = str(status_data.get("ilink_bot_id", "") or "").strip()
        base_url = str(status_data.get("baseurl", "") or session.get("base_url") or _WEIXIN_DEFAULT_BASE_URL).strip()

        config = _load_config_dict(request)
        channels = config.setdefault("channels", {})
        existing = channels.get("weixin", {})
        existing.update(
            {
                "enabled": True,
                "allow_from": session.get("allow_from") or existing.get("allow_from") or ["*"],
                "token": token,
                "base_url": base_url,
            }
        )
        if session.get("route_tag") is not None:
            existing["route_tag"] = session["route_tag"]
        if account:
            existing["account"] = account
            existing["user_id"] = account
        if bot_id:
            existing["bot_id"] = bot_id
        channels["weixin"] = existing
        _save_config_dict(config, request)

        message = await _start_configured_channel(request, "weixin", existing)
        sessions.pop(session_id, None)
        return WeixinQrStatusResponse(
            session_id=session_id,
            status="confirmed",
            message=message,
            account=account or bot_id or None,
        )

    if status == "scaned_but_redirect":
        redirect_host = str(status_data.get("redirect_host", "") or "").strip()
        if redirect_host:
            redirected_base = redirect_host if redirect_host.startswith(("http://", "https://")) else f"https://{redirect_host}"
            session["poll_base_url"] = redirected_base.rstrip("/")
        return WeixinQrStatusResponse(
            session_id=session_id,
            status="scanned",
            message="QR code scanned, waiting for confirmation",
            expires_at=session.get("expires_at"),
        )

    if status == "scaned":
        return WeixinQrStatusResponse(
            session_id=session_id,
            status="scanned",
            message="QR code scanned, waiting for confirmation",
            expires_at=session.get("expires_at"),
        )

    if status == "expired":
        sessions.pop(session_id, None)
        return WeixinQrStatusResponse(
            session_id=session_id,
            status="expired",
            message="QR code expired, please refresh",
        )

    return WeixinQrStatusResponse(
        session_id=session_id,
        status="waiting_scan",
        message="Waiting for scan",
        expires_at=session.get("expires_at"),
    )


@router.post("/channels/weixin/qr/{session_id}/cancel")
async def cancel_weixin_qr_login(request: Request, session_id: str) -> dict:
    """Cancel an in-memory WeChat QR login session."""
    _get_weixin_qr_sessions(request).pop(session_id, None)
    return {"ok": True}


@router.post("/channels/feishu/qr/start", response_model=FeishuQrStartResponse)
async def start_feishu_qr_registration(request: Request, body: FeishuQrStartRequest) -> FeishuQrStartResponse:
    """Create a Feishu one-click app registration QR session."""
    _require_supported_channel("feishu")

    mgr = _get_channel_manager(request)
    running_channels = mgr.get_status() if mgr else {}
    is_running = "feishu" in running_channels and running_channels["feishu"].get("running", False)
    if is_running:
        raise HTTPException(409, "Disconnect the channel before modifying its configuration")

    try:
        data = await _feishu_registration_request(
            base_url=_FEISHU_DEFAULT_ACCOUNTS_BASE_URL,
            params={
                "action": "begin",
                "archetype": "PersonalAgent",
                "auth_method": "client_secret",
                "request_user_info": "open_id",
            },
        )
    except Exception as e:
        logger.warning("Failed to create Feishu QR registration session: %s", e)
        raise HTTPException(502, f"Failed to get Feishu registration QR code: {e}") from e

    verification_uri = str(data.get("verification_uri_complete", "") or "").strip()
    device_code = str(data.get("device_code", "") or "").strip()
    if not verification_uri or not device_code:
        raise HTTPException(502, "Feishu did not return a valid registration QR code")

    config = _load_config_dict(request)
    existing = config.get("channels", {}).get("feishu", {})
    interval = max(1, _int_or_default(data.get("interval"), 5))
    expires_in = max(1, _int_or_default(data.get("expires_in"), 600))
    expires_at = time.time() + expires_in
    scan_url = _feishu_registration_qr_url(verification_uri)

    _cleanup_feishu_qr_sessions(request)
    session_id = uuid.uuid4().hex
    _get_feishu_qr_sessions(request)[session_id] = {
        "device_code": device_code,
        "base_url": _FEISHU_DEFAULT_ACCOUNTS_BASE_URL,
        "lark_base_url": _FEISHU_DEFAULT_LARK_ACCOUNTS_BASE_URL,
        "interval": interval,
        "allow_from": body.allow_from or existing.get("allow_from") or ["*"],
        "expires_at": expires_at,
        "domain_switched": False,
    }

    return FeishuQrStartResponse(
        session_id=session_id,
        scan_url=scan_url,
        expires_at=expires_at,
    )


@router.get("/channels/feishu/qr/{session_id}", response_model=FeishuQrStatusResponse)
async def get_feishu_qr_registration_status(request: Request, session_id: str) -> FeishuQrStatusResponse:
    """Poll a Feishu one-click app registration session and save credentials once confirmed."""
    sessions = _get_feishu_qr_sessions(request)
    session = sessions.get(session_id)
    now = time.time()
    if not session:
        return FeishuQrStatusResponse(
            session_id=session_id,
            status="expired",
            message="QR registration session expired",
        )
    if float(session.get("expires_at", 0)) <= now:
        sessions.pop(session_id, None)
        return FeishuQrStatusResponse(
            session_id=session_id,
            status="expired",
            message="QR code expired, please refresh",
        )

    try:
        poll_data = await _feishu_registration_request(
            base_url=str(session["base_url"]),
            params={
                "action": "poll",
                "device_code": session["device_code"],
            },
        )
    except Exception as e:
        logger.warning("Failed to poll Feishu QR registration session %s: %s", session_id, e)
        return FeishuQrStatusResponse(
            session_id=session_id,
            status="error",
            message=str(e),
            expires_at=session.get("expires_at"),
        )

    user_info = poll_data.get("user_info") if isinstance(poll_data.get("user_info"), dict) else {}
    tenant_brand = str(user_info.get("tenant_brand", "") or "").strip()
    if tenant_brand == "lark" and not session.get("domain_switched"):
        session["base_url"] = str(session["lark_base_url"])
        session["domain_switched"] = True
        return FeishuQrStatusResponse(
            session_id=session_id,
            status="waiting_scan",
            message="Switched to Lark domain",
            expires_at=session.get("expires_at"),
            provider_status="domain_switched",
            interval=_int_or_default(session.get("interval"), 5),
        )

    app_id = str(poll_data.get("client_id", "") or "").strip()
    app_secret = str(poll_data.get("client_secret", "") or "").strip()
    if app_id and app_secret:
        account = str(user_info.get("open_id", "") or "").strip()

        config = _load_config_dict(request)
        channels = config.setdefault("channels", {})
        existing = channels.get("feishu", {})
        existing.update(
            {
                "enabled": True,
                "allow_from": session.get("allow_from") or existing.get("allow_from") or ["*"],
                "app_id": app_id,
                "app_secret": app_secret,
                "domain": "lark" if tenant_brand == "lark" else "feishu",
            }
        )
        if account:
            existing["account"] = account
            existing["user_id"] = account
        channels["feishu"] = existing
        _save_config_dict(config, request)

        message = await _start_configured_channel(request, "feishu", existing)
        sessions.pop(session_id, None)
        return FeishuQrStatusResponse(
            session_id=session_id,
            status="confirmed",
            message=message,
            account=account or None,
        )

    error = str(poll_data.get("error", "") or "").strip()
    if error == "authorization_pending":
        return FeishuQrStatusResponse(
            session_id=session_id,
            status="waiting_scan",
            message="Waiting for scan",
            expires_at=session.get("expires_at"),
            provider_status="polling",
            interval=_int_or_default(session.get("interval"), 5),
        )
    if error == "slow_down":
        session["interval"] = _int_or_default(session.get("interval"), 5) + 5
        return FeishuQrStatusResponse(
            session_id=session_id,
            status="waiting_scan",
            message="Polling slowed down",
            expires_at=session.get("expires_at"),
            provider_status="slow_down",
            interval=_int_or_default(session.get("interval"), 10),
        )
    if error in {"access_denied", "expired_token"}:
        sessions.pop(session_id, None)
        status = "expired" if error == "expired_token" else "error"
        return FeishuQrStatusResponse(
            session_id=session_id,
            status=status,
            message=str(poll_data.get("error_description", "") or error),
        )
    if error:
        sessions.pop(session_id, None)
        return FeishuQrStatusResponse(
            session_id=session_id,
            status="error",
            message=str(poll_data.get("error_description", "") or error),
        )

    return FeishuQrStatusResponse(
        session_id=session_id,
        status="waiting_scan",
        message="Waiting for scan",
        expires_at=session.get("expires_at"),
        provider_status="polling",
        interval=_int_or_default(session.get("interval"), 5),
    )


@router.post("/channels/feishu/qr/{session_id}/cancel")
async def cancel_feishu_qr_registration(request: Request, session_id: str) -> dict:
    """Cancel an in-memory Feishu QR registration session."""
    _get_feishu_qr_sessions(request).pop(session_id, None)
    return {"ok": True}


@router.post("/channels/login")
async def login_channel(request: Request, body: ChannelLoginRequest):
    """Start interactive login for a supported channel."""
    _require_supported_channel(body.channel)

    mgr = _get_channel_manager(request)
    if mgr is None:
        raise HTTPException(503, "Channel manager not initialized")

    channel = mgr.get_channel(body.channel)
    if channel is None:
        raise HTTPException(404, f"Channel {body.channel} not configured")

    try:
        result = await channel.login(force=True)
        return {"ok": result, "message": "Login completed" if result else "Login failed"}
    except Exception as e:
        return {"ok": False, "message": str(e)}


@router.post("/channels/remove")
async def remove_channel(request: Request, body: ChannelRemoveRequest) -> dict:
    """Remove a channel — stops it and removes from config."""
    _require_supported_channel(body.channel)

    # Stop the running channel
    mgr = _get_channel_manager(request)
    if mgr:
        channel = mgr.get_channel(body.channel)
        if channel:
            try:
                await channel.stop()
            except Exception as e:
                logger.warning("Error stopping %s: %s", body.channel, e)
        mgr.remove_channel(body.channel)

    # Remove from config
    config = _load_config_dict(request)
    channels = config.get("channels", {})
    if body.channel in channels:
        channels[body.channel]["enabled"] = False
        _save_config_dict(config, request)

    return {"ok": True, "message": f"{body.channel} disconnected"}
