"""Configuration management endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_custom_endpoints
from app.dependencies import ProviderRegistryDep, SettingsDep
from app.media_model_config import (
    DEFAULT_DATAEYES_MEDIA_BASE_URL,
    DEFAULT_VIMAX_MEDIA_BASE_URL,
    PUBLIC_VIMAX_MEDIA_PRESETS,
    VIMAX_MEDIA_PRESETS,
    normalize_vimax_media_preset,
    vimax_media_preset,
)
from app.provider.catalog import PROVIDER_CATALOG
from app.provider.factory import create_provider as create_desktop_provider
from app.provider.local import (
    LOCAL_BASE_URL_ENV,
    LOCAL_PROVIDER_ID,
    create_local_provider,
)
from app.provider.openrouter import OpenRouterProvider
from app.schemas.provider import (
    ApiKeyStatus,
    ApiKeyUpdate,
    CustomEndpointConfig,
    CustomEndpointCreate,
    CustomEndpointUpdate,
    ProviderInfo,
    ProviderKeyUpdate,
    ProviderTestResult,
    ProviderToggleUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_custom_endpoints_lock = asyncio.Lock()

# Persist runtime config in current working directory.
#
# Desktop mode (`run.py`) changes cwd to the app data directory, so this
# becomes a writable per-user `.env` (instead of the read-only app bundle path
# when running from a mounted DMG volume).
# Server mode runs with `/opt/workcraft-proxy` as working directory, so behavior
# remains compatible there as well.
_ENV_PATH = Path(".env")


def _mask_key(key: str) -> str:
    """Mask API key for display: show first 7 and last 4 chars."""
    if len(key) <= 11:
        return "****"
    return f"{key[:7]}...{key[-4:]}"


def _build_custom_endpoint_info(
    ce: dict[str, Any],
    *,
    enabled: bool,
    status: str,
    model_count: int = 0,
) -> ProviderInfo:
    """Build ProviderInfo for a custom endpoint."""
    return ProviderInfo(
        id=ce["id"],
        name=ce.get("name", "Custom Endpoint"),
        is_configured=True,
        enabled=enabled,
        masked_key=_mask_key(ce.get("api_key", "")) if ce.get("api_key") else None,
        model_count=model_count,
        status=status,
        base_url=ce.get("base_url"),
    )


async def _validate_provider_connection(
    provider_id: str,
    api_key: str,
    *,
    base_url: str | None = None,
) -> tuple[int, list[str]]:
    """Create a temporary provider and list models without mutating settings."""
    try:
        test_provider = create_desktop_provider(provider_id, api_key, base_url=base_url)
        models = await test_provider.list_models()
    except ImportError as e:
        raise HTTPException(
            400,
            f"Provider '{provider_id}' requires an additional package: {e}",
        )
    except Exception as e:
        logger.warning("Provider validation failed for %s: %s", provider_id, e)
        raise HTTPException(400, f"Validation failed: {e}")

    return len(models), [m.name or m.id for m in models[:20]]


def _update_env_file(key: str, value: str) -> None:
    """Update or add a key=value pair in the backend .env file.

    Values are single-quoted to prevent python-dotenv from interpreting
    special characters (``#`` as inline comments, whitespace stripping, etc.).
    """
    lines: list[str] = []
    found = False
    # Single-quote the value; escape any embedded single quotes.
    escaped = value.replace("'", "'\\''")
    entry = f"{key}='{escaped}'"

    if _ENV_PATH.exists():
        lines = _ENV_PATH.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            if line.startswith(f"{key}=") or line.startswith(f"{key} ="):
                lines[i] = entry
                found = True
                break

    if not found:
        lines.append(entry)

    _ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _remove_env_key(key: str) -> None:
    """Remove a key from the backend .env file entirely."""
    if not _ENV_PATH.exists():
        return
    lines = _ENV_PATH.read_text(encoding="utf-8").splitlines()
    lines = [l for l in lines if not l.startswith(f"{key}=") and not l.startswith(f"{key} =")]
    _ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


class LocalProviderStatus(BaseModel):
    """Status for the locally-configured OpenAI-compatible endpoint."""

    base_url: str = ""
    is_configured: bool = False
    is_connected: bool = False
    status: str = "unconfigured"  # "connected" | "error" | "unconfigured"


class LocalProviderUpdate(BaseModel):
    """Request payload for configuring the local endpoint."""

    base_url: str


class ViMaxMediaModelOption(BaseModel):
    id: str
    label: str
    description: str = ""
    preset: str
    metadata: dict[str, str] = Field(default_factory=dict)
    default_base_url: str = ""


class ViMaxMediaCompatibleTool(BaseModel):
    tool_id: str
    scope: str
    adapter_status: str


class ViMaxMediaConfigStatus(BaseModel):
    preset: str
    preset_label: str
    base_url: str
    image_model: str
    video_model: str
    video_t2v_model: str
    video_ff2v_model: str
    video_flf2v_model: str
    image_api_version: str
    video_api_version: str
    has_api_key: bool = False
    masked_api_key: str | None = None
    key_source: str = ""
    ready: bool = False
    missing: list[str] = Field(default_factory=list)
    presets: list[ViMaxMediaModelOption] = Field(default_factory=list)
    image_models: list[ViMaxMediaModelOption] = Field(default_factory=list)
    video_models: list[ViMaxMediaModelOption] = Field(default_factory=list)
    compatible_tools: list[ViMaxMediaCompatibleTool] = Field(default_factory=list)


class ViMaxMediaConfigUpdate(BaseModel):
    preset: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False
    base_url: str | None = None
    image_model: str | None = None
    video_model: str | None = None
    video_t2v_model: str | None = None
    video_ff2v_model: str | None = None
    video_flf2v_model: str | None = None
    image_api_version: str | None = None
    video_api_version: str | None = None


def _normalize_local_base_url(value: str) -> str:
    """Normalize user input and ensure it includes a scheme."""
    trimmed = value.strip()
    if not trimmed:
        raise HTTPException(400, "Base URL cannot be empty")
    parsed = urlparse(trimmed)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(400, "Base URL must include http:// or https://")
    return trimmed.rstrip("/")


def _normalize_optional_http_base_url(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return ""
    parsed = urlparse(trimmed)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(400, "Base URL must include http:// or https://")
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(400, "Base URL must use http:// or https://")
    return trimmed.rstrip("/")


def _persist_runtime_setting(settings: Any, attr: str, env_key: str, value: str) -> None:
    clean = value.strip()
    setattr(settings, attr, clean)
    if clean:
        _update_env_file(env_key, clean)
    else:
        _remove_env_key(env_key)


def _vimax_media_options() -> tuple[
    list[ViMaxMediaModelOption],
    list[ViMaxMediaModelOption],
    list[ViMaxMediaModelOption],
]:
    presets: list[ViMaxMediaModelOption] = []
    image_models: list[ViMaxMediaModelOption] = []
    video_models: list[ViMaxMediaModelOption] = []
    for preset_id, config in VIMAX_MEDIA_PRESETS.items():
        if preset_id not in PUBLIC_VIMAX_MEDIA_PRESETS:
            continue
        presets.append(
            ViMaxMediaModelOption(
                id=preset_id,
                label=str(config["label"]),
                description=str(config.get("description") or ""),
                preset=preset_id,
                default_base_url=_default_media_base_url_for_preset(preset_id),
            )
        )
        image = config.get("image") if isinstance(config.get("image"), dict) else {}
        video = config.get("video") if isinstance(config.get("video"), dict) else {}
        image_model = str(image.get("model") or "")
        video_model = str(video.get("model") or video.get("ff2v_model") or "")
        if image_model:
            image_models.append(
                ViMaxMediaModelOption(
                    id=image_model,
                    label=image_model,
                    description=str(config.get("description") or ""),
                    preset=preset_id,
                    metadata={
                        "api_version": str(image.get("api_version") or ""),
                        "class_path": str(image.get("class_path") or ""),
                    },
                    default_base_url=_default_media_base_url_for_preset(preset_id),
                )
            )
        if video_model:
            video_models.append(
                ViMaxMediaModelOption(
                    id=video_model,
                    label=video_model,
                    description=str(config.get("description") or ""),
                    preset=preset_id,
                    metadata={
                        "api_version": str(video.get("api_version") or ""),
                        "class_path": str(video.get("class_path") or ""),
                        "t2v_model": str(video.get("t2v_model") or video_model),
                        "ff2v_model": str(video.get("ff2v_model") or video_model),
                        "flf2v_model": str(video.get("flf2v_model") or video_model),
                    },
                    default_base_url=_default_media_base_url_for_preset(preset_id),
                )
            )
    return presets, image_models, video_models


def _default_media_base_url_for_preset(preset_id: str) -> str:
    if preset_id in {"doubao", "gemini"}:
        return DEFAULT_VIMAX_MEDIA_BASE_URL
    if preset_id in {"dataeyes", "dataeyes_gemini_veo"}:
        return DEFAULT_DATAEYES_MEDIA_BASE_URL
    if preset_id == "config":
        return ""
    return DEFAULT_VIMAX_MEDIA_BASE_URL


def _vimax_custom_yunwu_key(settings: Any) -> str:
    candidates = []
    for endpoint in get_custom_endpoints(settings):
        base_url = str(endpoint.get("base_url") or "").lower()
        if "yunwu.ai" in base_url:
            candidates.append(endpoint)
    for endpoint in [*filter(lambda item: item.get("enabled", True), candidates), *candidates]:
        api_key = str(endpoint.get("api_key") or "").strip()
        if api_key:
            return api_key
    return ""


def _vimax_custom_dataeyes_key(settings: Any) -> str:
    candidates = []
    for endpoint in get_custom_endpoints(settings):
        base_url = str(endpoint.get("base_url") or "").lower()
        if "dataeyes.ai" in base_url:
            candidates.append(endpoint)
    for endpoint in [*filter(lambda item: item.get("enabled", True), candidates), *candidates]:
        api_key = str(endpoint.get("api_key") or "").strip()
        if api_key:
            return api_key
    return ""


def _vimax_media_key_status(settings: Any, preset_id: str) -> tuple[str, str]:
    explicit = str(getattr(settings, "vimax_media_api_key", "") or "").strip()
    if explicit:
        return explicit, "vimax_media_api_key"

    if preset_id in {"dataeyes", "dataeyes_gemini_veo"}:
        dataeyes = _vimax_custom_dataeyes_key(settings)
        if dataeyes:
            return dataeyes, "custom_dataeyes_endpoint"
        return "", ""

    if preset_id in {"gemini", "doubao"}:
        yunwu = str(getattr(settings, "vimax_yunwu_api_key", "") or "").strip()
        if yunwu:
            return yunwu, "vimax_yunwu_api_key"
        custom = _vimax_custom_yunwu_key(settings)
        if custom:
            return custom, "custom_yunwu_endpoint"
        return "", ""

    if preset_id == "config":
        return "", ""

    yunwu = str(getattr(settings, "vimax_yunwu_api_key", "") or "").strip()
    if yunwu:
        return yunwu, "vimax_yunwu_api_key"
    custom = _vimax_custom_yunwu_key(settings)
    if custom:
        return custom, "custom_yunwu_endpoint"
    google = str(getattr(settings, "vimax_google_api_key", "") or "").strip()
    if google:
        return google, "vimax_google_api_key"
    provider_google = str(getattr(settings, "google_api_key", "") or "").strip()
    if provider_google:
        return provider_google, "google_api_key"
    return "", ""


def _vimax_media_config_status(settings: Any) -> ViMaxMediaConfigStatus:
    raw_preset = str(getattr(settings, "vimax_media_preset", "") or "").strip()
    preset_id = normalize_vimax_media_preset(raw_preset)
    preset = vimax_media_preset(preset_id)
    image = preset.get("image") if isinstance(preset.get("image"), dict) else {}
    video = preset.get("video") if isinstance(preset.get("video"), dict) else {}
    default_image_model = str(image.get("model") or "")
    default_video_model = str(video.get("model") or video.get("ff2v_model") or "")
    default_t2v_model = str(video.get("t2v_model") or default_video_model)
    default_ff2v_model = str(video.get("ff2v_model") or default_video_model)
    default_flf2v_model = str(video.get("flf2v_model") or default_video_model)
    api_key, key_source = _vimax_media_key_status(settings, preset_id)
    default_base_url = _default_media_base_url_for_preset(preset_id)
    base_url = default_base_url
    image_api_version = (
        str(getattr(settings, "vimax_image_api_version", "") or "").strip()
        or str(getattr(settings, "vimax_media_api_version", "") or "").strip()
        or str(image.get("api_version") or "")
    )
    video_api_version = (
        str(getattr(settings, "vimax_video_api_version", "") or "").strip()
        or str(video.get("api_version") or "")
    )
    missing: list[str] = []
    if not raw_preset:
        missing.append("preset")
    if preset_id != "config" and not api_key:
        missing.append("api_key")
    presets, image_models, video_models = _vimax_media_options()
    return ViMaxMediaConfigStatus(
        preset=preset_id,
        preset_label=str(preset.get("label") or preset_id),
        base_url=base_url,
        image_model=str(getattr(settings, "vimax_image_model", "") or "").strip() or default_image_model,
        video_model=str(getattr(settings, "vimax_video_model", "") or "").strip() or default_video_model,
        video_t2v_model=str(getattr(settings, "vimax_video_t2v_model", "") or "").strip() or default_t2v_model,
        video_ff2v_model=str(getattr(settings, "vimax_video_ff2v_model", "") or "").strip() or default_ff2v_model,
        video_flf2v_model=str(getattr(settings, "vimax_video_flf2v_model", "") or "").strip() or default_flf2v_model,
        image_api_version=image_api_version,
        video_api_version=video_api_version,
        has_api_key=bool(api_key),
        masked_api_key=_mask_key(api_key) if api_key else None,
        key_source=key_source,
        ready=not missing,
        missing=missing,
        presets=presets,
        image_models=image_models,
        video_models=video_models,
        compatible_tools=[
            ViMaxMediaCompatibleTool(
                tool_id="vimax_generate_video",
                scope="image+video",
                adapter_status="active",
            ),
            ViMaxMediaCompatibleTool(
                tool_id="baoyu_image_generate",
                scope="image",
                adapter_status="reserved",
            ),
        ],
    )


def _local_provider_status(settings: Any, registry: Any) -> LocalProviderStatus:
    """Build a status object from the current configuration + registry state."""
    base_url = settings.local_base_url or ""
    provider = registry.get_provider(LOCAL_PROVIDER_ID)
    is_connected = bool(base_url and provider)
    status = "connected" if is_connected else ("error" if base_url else "unconfigured")
    return LocalProviderStatus(
        base_url=base_url,
        is_configured=bool(base_url),
        is_connected=is_connected,
        status=status,
    )


@router.get("/config/vimax-media", response_model=ViMaxMediaConfigStatus)
async def get_vimax_media_config(settings: SettingsDep) -> ViMaxMediaConfigStatus:
    """Return the WorkCraft-managed media model defaults for ViMax."""
    return _vimax_media_config_status(settings)


@router.patch("/config/vimax-media", response_model=ViMaxMediaConfigStatus)
async def update_vimax_media_config(
    settings: SettingsDep,
    body: ViMaxMediaConfigUpdate,
) -> ViMaxMediaConfigStatus:
    """Persist ViMax media model defaults used by vimax_generate_video."""
    if body.preset is not None:
        requested = str(body.preset or "").strip().lower()
        if requested and requested not in VIMAX_MEDIA_PRESETS and requested not in {
            "auto",
            "google",
            "veo",
            "nanobanana",
            "seedream",
            "seedance",
            "dataeye",
            "dataeyes",
            "dataeyes_gemini",
            "dataeyes_veo",
            "dataeyes_gemini_veo",
            "dataeyes_nanobanana",
            "yaml",
            "default",
        }:
            raise HTTPException(400, f"Unsupported ViMax media preset: {body.preset}")
        _persist_runtime_setting(
            settings,
            "vimax_media_preset",
            "WORKCRAFT_VIMAX_MEDIA_PRESET",
            normalize_vimax_media_preset(body.preset),
        )

    if body.clear_api_key:
        _persist_runtime_setting(settings, "vimax_media_api_key", "WORKCRAFT_VIMAX_MEDIA_API_KEY", "")
    elif body.api_key is not None:
        _persist_runtime_setting(
            settings,
            "vimax_media_api_key",
            "WORKCRAFT_VIMAX_MEDIA_API_KEY",
            str(body.api_key or "").strip(),
        )

    if body.base_url is not None:
        _persist_runtime_setting(
            settings,
            "vimax_media_base_url",
            "WORKCRAFT_VIMAX_MEDIA_BASE_URL",
            "",
        )

    for attr, env_key, value in [
        ("vimax_image_model", "WORKCRAFT_VIMAX_IMAGE_MODEL", body.image_model),
        ("vimax_video_model", "WORKCRAFT_VIMAX_VIDEO_MODEL", body.video_model),
        ("vimax_video_t2v_model", "WORKCRAFT_VIMAX_VIDEO_T2V_MODEL", body.video_t2v_model),
        ("vimax_video_ff2v_model", "WORKCRAFT_VIMAX_VIDEO_FF2V_MODEL", body.video_ff2v_model),
        ("vimax_video_flf2v_model", "WORKCRAFT_VIMAX_VIDEO_FLF2V_MODEL", body.video_flf2v_model),
        ("vimax_image_api_version", "WORKCRAFT_VIMAX_IMAGE_API_VERSION", body.image_api_version),
        ("vimax_video_api_version", "WORKCRAFT_VIMAX_VIDEO_API_VERSION", body.video_api_version),
    ]:
        if value is not None:
            _persist_runtime_setting(settings, attr, env_key, str(value or ""))

    return _vimax_media_config_status(settings)


@router.get("/config/api-key", response_model=ApiKeyStatus)
async def get_api_key_status(registry: ProviderRegistryDep) -> ApiKeyStatus:
    """Get the current API key configuration status."""
    provider = registry.get_provider("openrouter")

    if provider is None or not getattr(provider, "_api_key", ""):
        return ApiKeyStatus(is_configured=False)

    return ApiKeyStatus(
        is_configured=True,
        masked_key=_mask_key(provider._api_key),
    )


@router.post("/config/api-key", response_model=ApiKeyStatus)
async def update_api_key(registry: ProviderRegistryDep, body: ApiKeyUpdate) -> ApiKeyStatus:
    """Update the OpenRouter API key, validate it, and re-initialize the provider."""
    api_key = body.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")

    # Validate by attempting to fetch models with the new key
    test_provider = OpenRouterProvider(api_key)
    try:
        models = await test_provider.list_models()
        if not models:
            raise HTTPException(
                status_code=400,
                detail="API key is valid but returned no models",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("API key validation failed: %s", e)
        raise HTTPException(
            status_code=400,
            detail=f"API key validation failed: {e}",
        )

    # Key is valid — replace the provider in the registry
    new_provider = OpenRouterProvider(api_key)
    registry.register(new_provider)

    # Refresh the model index so the frontend picks up the new models
    try:
        await registry.refresh_models()
    except Exception as e:
        logger.warning("Model refresh failed after API key update: %s — will retry on next request", e)

    # Persist to .env so it survives restarts
    _update_env_file("WORKCRAFT_OPENROUTER_API_KEY", api_key)

    return ApiKeyStatus(
        is_configured=True,
        masked_key=_mask_key(api_key),
        is_valid=True,
    )


@router.delete("/config/api-key", response_model=ApiKeyStatus)
async def delete_api_key(settings: SettingsDep, registry: ProviderRegistryDep) -> ApiKeyStatus:
    """Delete the stored OpenRouter API key."""
    settings.openrouter_api_key = ""
    _remove_env_key("WORKCRAFT_OPENROUTER_API_KEY")

    # Only unregister the provider if not in proxy mode.
    # In proxy mode the active "openrouter" provider belongs to the proxy,
    # not the direct API key — don't remove it.
    if not (settings.proxy_url and settings.proxy_token):
        registry.unregister("openrouter")

    return ApiKeyStatus(is_configured=False)


# ── WorkCraft Account (proxy mode) ───────────────────────────────────────────

class WorkCraftAccountStatus(BaseModel):
    is_connected: bool = False
    proxy_url: str = ""
    email: str = ""
    has_refresh_token: bool = False


class WorkCraftAccountConnect(BaseModel):
    proxy_url: str  # e.g. "https://api.workcraft.app"
    token: str  # JWT from proxy auth
    refresh_token: str = ""  # Refresh token for auto-renewal


class WorkCraftAccountDisconnect(BaseModel):
    pass


def _is_unauthorized_error(exc: Exception) -> bool:
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 401


def _is_insufficient_balance_error(exc: Exception) -> bool:
    """Check if the error is due to insufficient account balance (not an auth failure).

    Works with both httpx.HTTPStatusError and OpenAI SDK exceptions.
    """
    # OpenAI SDK exceptions carry status_code and body in the message
    msg = str(exc)
    if "INSUFFICIENT_BALANCE" in msg:
        return True
    # httpx raw response
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 403:
        try:
            body = exc.response.json()
            return body.get("code") == "INSUFFICIENT_BALANCE"
        except (ValueError, KeyError, AttributeError):
            return False
    return False


async def _refresh_workcraft_proxy_token(
    proxy_url: str,
    refresh_token: str,
) -> tuple[str, str] | None:
    """Refresh a WorkCraft proxy access token without mutating persisted settings."""
    if not refresh_token:
        return None

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{proxy_url}/api/auth/refresh",
                json={"refresh_token": refresh_token},
                timeout=15.0,
            )
    except Exception as exc:
        logger.warning("WorkCraft token refresh failed: %s", exc)
        return None

    if resp.status_code != 200:
        logger.warning(
            "WorkCraft token refresh rejected: HTTP %d - %s",
            resp.status_code,
            resp.text[:200],
        )
        return None

    data = resp.json()
    access_token = data.get("access_token", "")
    if not access_token:
        logger.warning("WorkCraft token refresh returned empty access_token")
        return None

    return access_token, data.get("refresh_token", "") or refresh_token


@router.get("/config/workcraft-account", response_model=WorkCraftAccountStatus)
async def get_workcraft_account_status(settings: SettingsDep) -> WorkCraftAccountStatus:
    """Check if a WorkCraft account is connected (proxy mode active)."""
    if settings.proxy_url and settings.proxy_token:
        return WorkCraftAccountStatus(
            is_connected=True,
            proxy_url=settings.proxy_url,
            has_refresh_token=bool(settings.proxy_refresh_token),
        )
    return WorkCraftAccountStatus(is_connected=False)


@router.post("/config/workcraft-account", response_model=WorkCraftAccountStatus)
async def connect_workcraft_account(
    settings: SettingsDep, registry: ProviderRegistryDep, body: WorkCraftAccountConnect,
) -> WorkCraftAccountStatus:
    """Connect a WorkCraft account: switch provider to proxy mode.

    The local app will now route all LLM requests through the WorkCraft
    cloud proxy, which handles billing transparently.
    """
    proxy_url = body.proxy_url.rstrip("/")
    token = body.token.strip()

    if not proxy_url or not token:
        raise HTTPException(400, "proxy_url and token are required")

    # Validate by trying to list models through the proxy. Existing desktop
    # installs may hold an expired access token while still having a valid
    # refresh token, so refresh once on 401 before asking the user to sign in.
    refresh_token = body.refresh_token.strip()

    async def _list_proxy_models(access_token: str):
        # Use GenericOpenAIProvider for OpenAI-compatible APIs (like Sub2API)
        # OpenRouterProvider sends HTTP-Referer/X-Title headers that may not work
        # with non-OpenRouter services
        from app.provider.generic_openai import GenericOpenAIProvider
        test_provider = GenericOpenAIProvider(
            access_token,
            provider_id="workcraft-proxy-test",
            base_url=proxy_url + "/v1",
            kind="openai_compat_custom",
        )
        return await test_provider.list_models()

    models = []
    try:
        models = await _list_proxy_models(token)
    except HTTPException:
        raise
    except Exception as e:
        if _is_unauthorized_error(e) and refresh_token:
            refreshed = await _refresh_workcraft_proxy_token(proxy_url, refresh_token)
            if not refreshed:
                raise HTTPException(400, "WorkCraft session expired. Please sign in again.") from e
            token, refresh_token = refreshed
            try:
                models = await _list_proxy_models(token)
            except Exception as retry_error:
                logger.warning("WorkCraft account connection failed after token refresh: %s", retry_error)
                raise HTTPException(400, f"Failed to connect to proxy: {retry_error}") from retry_error
        elif _is_insufficient_balance_error(e):
            logger.info("Account connected but has insufficient balance — allowing connection")
        else:
            logger.warning("WorkCraft account connection failed: %s", e)
            raise HTTPException(400, f"Failed to connect to proxy: {e}") from e

    # Switch the provider registry to use the proxy
    # Use GenericOpenAIProvider for OpenAI-compatible APIs (like Sub2API)
    from app.provider.generic_openai import GenericOpenAIProvider
    new_provider = GenericOpenAIProvider(
        token,
        provider_id="workcraft-proxy",
        base_url=proxy_url + "/v1",
        kind="openai_compat_custom",
    )
    registry.register(new_provider)
    try:
        await registry.refresh_models()
    except Exception as e:
        logger.warning("Model refresh failed after proxy connect: %s — will retry on next request", e)

    # Persist to .env and update runtime settings
    _update_env_file("WORKCRAFT_PROXY_URL", proxy_url)
    _update_env_file("WORKCRAFT_PROXY_TOKEN", token)
    settings.proxy_url = proxy_url
    settings.proxy_token = token

    if refresh_token:
        _update_env_file("WORKCRAFT_PROXY_REFRESH_TOKEN", refresh_token)
        settings.proxy_refresh_token = refresh_token

    return WorkCraftAccountStatus(is_connected=True, proxy_url=proxy_url)


@router.delete("/config/workcraft-account", response_model=WorkCraftAccountStatus)
async def disconnect_workcraft_account(settings: SettingsDep, registry: ProviderRegistryDep) -> WorkCraftAccountStatus:
    """Disconnect WorkCraft account: revert to local API key mode."""
    # Clear proxy settings
    settings.proxy_url = ""
    settings.proxy_token = ""
    settings.proxy_refresh_token = ""
    _update_env_file("WORKCRAFT_PROXY_URL", "")
    _update_env_file("WORKCRAFT_PROXY_TOKEN", "")
    _remove_env_key("WORKCRAFT_PROXY_REFRESH_TOKEN")

    # Unregister proxy provider
    registry.unregister("workcraft-proxy")

    return WorkCraftAccountStatus(is_connected=False)


# ── Sub2API Proxy Endpoints ──────────────────────────────────────────────

SUB2API_URL = "https://aihub2.top"


class Sub2APIError(HTTPException):
    def __init__(self, code: int, message: str):
        super().__init__(status_code=400, detail=message)
        self.sub2api_code = code


def _unwrap_sub2api_response(resp: httpx.Response) -> Any:
    """Unwrap Sub2API nested response {code, message, data} -> data."""
    if resp.status_code != 200:
        # Try to extract the structured error message from Sub2API response
        try:
            body = resp.json()
            msg = body.get("message") or body.get("error") or body.get("reason")
            if msg:
                raise HTTPException(resp.status_code, msg)
        except (ValueError, KeyError, AttributeError):
            pass
        raise HTTPException(resp.status_code, f"Sub2API error: {resp.text[:200]}")
    body = resp.json()
    if body.get("code", 0) != 0:
        raise Sub2APIError(body["code"], body.get("message", "Unknown error"))
    return body.get("data")


class Sub2APILoginRequest(BaseModel):
    email: str
    password: str


class Sub2APIRegisterRequest(BaseModel):
    email: str
    password: str
    verify_code: str


class Sub2APISendVerifyCodeRequest(BaseModel):
    email: str


class Sub2APIForgotPasswordRequest(BaseModel):
    email: str
    turnstile_token: str | None = None


class Sub2APIResetPasswordRequest(BaseModel):
    email: str
    token: str
    new_password: str


class Sub2APITokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    user: dict


class Sub2API2FAResponse(BaseModel):
    requires_2fa: bool = True
    temp_token: str
    user_email_masked: str


class Sub2APIKeyResponse(BaseModel):
    id: int
    key: str
    name: str
    status: str
    group_id: int | None = None


class Sub2APIGroupResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    status: str = "active"
    subscription_type: str | None = None
    monthly_limit_usd: float | None = None


class Sub2APIKeysListResponse(BaseModel):
    items: list[dict]
    total: int


@router.post("/proxy-auth/login")
async def proxy_auth_login(body: Sub2APILoginRequest) -> Sub2APITokenResponse | Sub2API2FAResponse:
    """Proxy login to Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/auth/login",
            json={"email": body.email, "password": body.password},
            timeout=15.0,
        )
    data = _unwrap_sub2api_response(resp)
    if data.get("requires_2fa"):
        return Sub2API2FAResponse(
            requires_2fa=True,
            temp_token=data.get("temp_token", ""),
            user_email_masked=data.get("user_email_masked", ""),
        )
    return Sub2APITokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=data.get("expires_in", 3600),
        user=data.get("user", {}),
    )


@router.post("/proxy-auth/register")
async def proxy_auth_register(body: Sub2APIRegisterRequest) -> dict:
    """Proxy register to Sub2API (requires verification code)."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/auth/register",
            json={"email": body.email, "password": body.password, "verify_code": body.verify_code},
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)


@router.post("/proxy-auth/send-verify-code")
async def proxy_auth_send_verify_code(body: Sub2APISendVerifyCodeRequest) -> dict:
    """Proxy send verification code to Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/auth/send-verify-code",
            json={"email": body.email},
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)


@router.post("/proxy-auth/forgot-password")
async def proxy_auth_forgot_password(body: Sub2APIForgotPasswordRequest) -> dict:
    """Proxy forgot-password request to Sub2API."""
    payload: dict[str, str] = {"email": body.email}
    if body.turnstile_token:
        payload["turnstile_token"] = body.turnstile_token
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/auth/forgot-password",
            json=payload,
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)


@router.post("/proxy-auth/reset-password")
async def proxy_auth_reset_password(body: Sub2APIResetPasswordRequest) -> dict:
    """Proxy password reset to Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/auth/reset-password",
            json={
                "email": body.email,
                "token": body.token,
                "new_password": body.new_password,
            },
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)


@router.post("/proxy-auth/refresh")
async def proxy_auth_refresh(body: dict) -> Sub2APITokenResponse:
    """Proxy token refresh to Sub2API."""
    refresh_token = body.get("refresh_token")
    if not refresh_token:
        raise HTTPException(400, "refresh_token required")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/auth/refresh",
            json={"refresh_token": refresh_token},
            timeout=15.0,
        )
    data = _unwrap_sub2api_response(resp)
    return Sub2APITokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=data.get("expires_in", 3600),
        user={},
    )


@router.get("/proxy-auth/me")
async def proxy_auth_me(token: str) -> dict:
    """Proxy user profile fetch to Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUB2API_URL}/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)


@router.get("/proxy-keys/list")
async def proxy_keys_list(token: str) -> Sub2APIKeysListResponse:
    """List user's API keys from Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUB2API_URL}/api/v1/keys",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    data = _unwrap_sub2api_response(resp)
    return Sub2APIKeysListResponse(items=data.get("items", []), total=data.get("total", 0))


@router.post("/proxy-keys/create")
async def proxy_keys_create(token: str, body: dict | None = None) -> Sub2APIKeyResponse:
    """Create a new API key in Sub2API."""
    body = body or {}
    name = body.get("name", "WorkCraft Desktop")
    group_id = body.get("group_id", 2)
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/keys",
            json={"name": name, "group_id": group_id},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    data = _unwrap_sub2api_response(resp)
    return Sub2APIKeyResponse(
        id=data["id"],
        key=data["key"],
        name=data.get("name", name),
        status=data.get("status", "active"),
        group_id=data.get("group_id"),
    )


@router.get("/proxy-keys/groups/available")
async def proxy_keys_available_groups(token: str) -> list[Sub2APIGroupResponse]:
    """List groups the current user can bind API keys to."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUB2API_URL}/api/v1/groups/available",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    data = _unwrap_sub2api_response(resp)
    groups = data if isinstance(data, list) else []
    return [
        Sub2APIGroupResponse(
            id=group["id"],
            name=group.get("name", ""),
            description=group.get("description"),
            status=group.get("status", "active"),
            subscription_type=group.get("subscription_type"),
            monthly_limit_usd=group.get("monthly_limit_usd"),
        )
        for group in groups
        if isinstance(group, dict) and group.get("id") is not None
    ]


# ── Sub2API Subscription Proxy Endpoints ─────────────────────────────────


@router.get("/proxy-subscriptions/active")
async def proxy_subscriptions_active(token: str) -> list[dict]:
    """List current user's active subscriptions from Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUB2API_URL}/api/v1/subscriptions/active",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    data = _unwrap_sub2api_response(resp)
    return data if isinstance(data, list) else []


# ── Sub2API Payment Proxy Endpoints ─────────────────────────────────────


@router.get("/proxy-payment/checkout-info")
async def proxy_payment_checkout_info(token: str) -> dict:
    """Get payment checkout info from Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUB2API_URL}/api/v1/payment/checkout-info",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)


@router.post("/proxy-payment/orders")
async def proxy_payment_create_order(token: str, body: dict) -> dict:
    """Create a payment order in Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/payment/orders",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)


@router.get("/proxy-payment/orders/my")
async def proxy_payment_my_orders(token: str) -> dict:
    """Get current user's orders from Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUB2API_URL}/api/v1/payment/orders/my",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)


@router.get("/proxy-payment/orders/{order_id}")
async def proxy_payment_order_detail(order_id: int, token: str) -> dict:
    """Get order detail from Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUB2API_URL}/api/v1/payment/orders/{order_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)


@router.post("/proxy-payment/orders/verify")
async def proxy_payment_verify_order(token: str, body: dict) -> dict:
    """Verify payment order status in Sub2API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUB2API_URL}/api/v1/payment/orders/verify",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
    return _unwrap_sub2api_response(resp)


# ── Ollama (Local LLM) ────────────────────────────────────────────────────


class OllamaStatus(BaseModel):
    is_configured: bool = False
    base_url: str | None = None
    model_count: int = 0
    error: str | None = None


class OllamaConnect(BaseModel):
    base_url: str = "http://localhost:11434"


@router.get("/config/ollama", response_model=OllamaStatus)
async def get_ollama_status(settings: SettingsDep, registry: ProviderRegistryDep) -> OllamaStatus:
    """Get the current Ollama configuration status."""
    provider = registry.get_provider("ollama")

    if provider is None or not settings.ollama_base_url:
        return OllamaStatus(is_configured=False)

    # Check live connectivity
    status = await provider.health_check()
    return OllamaStatus(
        is_configured=True,
        base_url=settings.ollama_base_url,
        model_count=status.model_count,
        error=status.error,
    )


@router.post("/config/ollama", response_model=OllamaStatus)
async def connect_ollama(
    settings: SettingsDep, registry: ProviderRegistryDep, body: OllamaConnect,
) -> OllamaStatus:
    """Connect to an Ollama instance: validate, register provider, persist."""
    from app.provider.ollama import OllamaProvider

    base_url = body.base_url.strip().rstrip("/")
    if not base_url:
        raise HTTPException(400, "base_url cannot be empty")

    # Validate by health-checking the target URL
    test_provider = OllamaProvider(base_url=base_url)
    status = await test_provider.health_check()
    if status.status != "connected":
        raise HTTPException(
            400,
            f"Cannot connect to Ollama at {base_url}: {status.error or 'unknown error'}",
        )

    # Register (replaces any prior Ollama provider)
    registry.register(test_provider)
    try:
        await registry.refresh_models()
    except Exception as e:
        logger.warning("Model refresh failed after Ollama connect: %s", e)

    # Persist to .env and runtime settings
    _update_env_file("WORKCRAFT_OLLAMA_BASE_URL", base_url)
    settings.ollama_base_url = base_url

    return OllamaStatus(
        is_configured=True,
        base_url=base_url,
        model_count=status.model_count,
    )


@router.delete("/config/ollama", response_model=OllamaStatus)
async def disconnect_ollama(settings: SettingsDep, registry: ProviderRegistryDep) -> OllamaStatus:
    """Disconnect Ollama: remove provider and clear config."""
    settings.ollama_base_url = ""
    _remove_env_key("WORKCRAFT_OLLAMA_BASE_URL")

    registry.unregister("ollama")

    return OllamaStatus(is_configured=False)


# ── Generic Multi-Provider API ─────────────────────────────────────────────


def _get_disabled_set(settings) -> set[str]:
    return {s.strip() for s in settings.disabled_providers.split(",") if s.strip()}


@router.get("/config/providers", response_model=list[ProviderInfo])
async def list_providers(settings: SettingsDep, registry: ProviderRegistryDep) -> list[ProviderInfo]:
    """List all BYOK providers with their configuration status."""
    disabled = _get_disabled_set(settings)

    result: list[ProviderInfo] = []
    for pid, pdef in PROVIDER_CATALOG.items():
        api_key = getattr(settings, pdef.settings_key, "")
        is_disabled = pid in disabled
        provider = registry.get_provider(pid)

        base_url = None
        if pdef.kind == "openai_compat_azure":
            base_url = getattr(settings, "azure_openai_base_url", "")

        if api_key and is_disabled:
            result.append(ProviderInfo(
                id=pid,
                name=pdef.name,
                is_configured=True,
                enabled=False,
                masked_key=_mask_key(api_key),
                status="disabled",
                base_url=base_url,
            ))
        elif provider and api_key:
            models = [m for p, m in registry._full_models if m.provider_id == pid]
            result.append(ProviderInfo(
                id=pid,
                name=pdef.name,
                is_configured=True,
                enabled=True,
                masked_key=_mask_key(api_key),
                model_count=len(models),
                status="connected",
                base_url=base_url,
            ))
        elif api_key:
            result.append(ProviderInfo(
                id=pid,
                name=pdef.name,
                is_configured=True,
                enabled=True,
                masked_key=_mask_key(api_key),
                status="error",
                base_url=base_url,
            ))
        else:
            result.append(ProviderInfo(
                id=pid,
                name=pdef.name,
                is_configured=False,
                enabled=not is_disabled,
                status="unconfigured",
                base_url=base_url,
            ))


    # Inject Custom Endpoints
    for ce in get_custom_endpoints(settings):
        pid = ce["id"]
        is_disabled = pid in disabled or not ce.get("enabled", True)
        provider = registry.get_provider(pid)

        if is_disabled:
            result.append(_build_custom_endpoint_info(ce, enabled=False, status="disabled"))
        elif provider:
            models = [m for p, m in registry._full_models if m.provider_id == pid]
            result.append(_build_custom_endpoint_info(ce, enabled=True, status="connected", model_count=len(models)))
        else:
            result.append(_build_custom_endpoint_info(ce, enabled=True, status="error"))

    return result


@router.post("/config/providers/{provider_id}/key", response_model=ProviderInfo)
async def set_provider_key(
    provider_id: str, body: ProviderKeyUpdate, settings: SettingsDep, registry: ProviderRegistryDep,
) -> ProviderInfo:
    """Set/update API key for a provider. Validates, registers, and persists."""
    pdef = PROVIDER_CATALOG.get(provider_id)
    if not pdef:
        raise HTTPException(404, f"Unknown provider: {provider_id}")

    api_key = body.api_key.strip()
    if not api_key:
        raise HTTPException(400, "API key cannot be empty")

    # Azure needs a base_url from the request body or existing settings
    extra_kwargs: dict[str, str] = {}
    if pdef.kind in ("openai_compat_azure",):
        url_setting_map = {
            "openai_compat_azure": "azure_openai_base_url",
        }
        url_setting = url_setting_map[pdef.kind]
        base_url = getattr(body, "base_url", None) or getattr(settings, url_setting, "")
        if not base_url:
            raise HTTPException(400, f"{pdef.name} requires a base_url to be set")
        extra_kwargs["base_url"] = base_url

        # Persist base_url
        setattr(settings, url_setting, base_url)
        _update_env_file(f"WORKCRAFT_{url_setting.upper()}", base_url)

    model_count, _ = await _validate_provider_connection(provider_id, api_key, **extra_kwargs)

    # Register in the registry (replaces any existing instance)
    new_provider = create_desktop_provider(provider_id, api_key, **extra_kwargs)
    disabled = _get_disabled_set(settings)
    should_enable = body.enabled is not False
    if should_enable:
        disabled.discard(provider_id)
        registry.register(new_provider)
    else:
        disabled.add(provider_id)
        registry.unregister(provider_id)

    if should_enable:
        try:
            await registry.refresh_models()
        except Exception as e:
            logger.warning(
                "Model refresh failed after %s key update: %s — will retry on next request",
                provider_id, e,
            )

    # Persist to .env
    env_key = f"WORKCRAFT_{pdef.settings_key.upper()}"
    _update_env_file(env_key, api_key)
    settings.disabled_providers = ",".join(sorted(disabled))
    _update_env_file("WORKCRAFT_DISABLED_PROVIDERS", settings.disabled_providers)

    # Update runtime settings
    setattr(settings, pdef.settings_key, api_key)

    return ProviderInfo(
        id=provider_id,
        name=pdef.name,
        is_configured=True,
        enabled=should_enable,
        masked_key=_mask_key(api_key),
        model_count=model_count if should_enable else 0,
        status="connected" if should_enable else "disabled",
        base_url=extra_kwargs.get("base_url"),
    )


@router.post("/config/providers/{provider_id}/test", response_model=ProviderTestResult)
async def test_provider_key(provider_id: str, body: ProviderKeyUpdate, settings: SettingsDep) -> ProviderTestResult:
    """Validate a provider key without saving it."""
    pdef = PROVIDER_CATALOG.get(provider_id)
    if not pdef:
        raise HTTPException(404, f"Unknown provider: {provider_id}")

    api_key = body.api_key.strip()
    if not api_key:
        raise HTTPException(400, "API key cannot be empty")

    extra_kwargs: dict[str, str] = {}
    if pdef.kind == "openai_compat_azure":
        base_url = body.base_url or getattr(settings, "azure_openai_base_url", "")
        if not base_url:
            raise HTTPException(400, f"{pdef.name} requires a base_url to be set")
        extra_kwargs["base_url"] = base_url

    model_count, models = await _validate_provider_connection(provider_id, api_key, **extra_kwargs)
    return ProviderTestResult(model_count=model_count, models=models)


@router.delete("/config/providers/{provider_id}/key", response_model=ProviderInfo)
async def delete_provider_key(
    provider_id: str, settings: SettingsDep, registry: ProviderRegistryDep,
) -> ProviderInfo:
    """Remove API key for a provider."""
    pdef = PROVIDER_CATALOG.get(provider_id)
    if not pdef:
        raise HTTPException(404, f"Unknown provider: {provider_id}")

    # Clear runtime settings
    setattr(settings, pdef.settings_key, "")

    # Remove from .env
    env_key = f"WORKCRAFT_{pdef.settings_key.upper()}"
    _remove_env_key(env_key)

    if pdef.kind == "openai_compat_azure":
        settings.azure_openai_base_url = ""
        _remove_env_key("WORKCRAFT_AZURE_OPENAI_BASE_URL")

    # Unregister provider
    registry.unregister(provider_id)

    return ProviderInfo(
        id=provider_id,
        name=pdef.name,
        is_configured=False,
        status="unconfigured",
    )


@router.post("/config/providers/{provider_id}/toggle", response_model=ProviderInfo)
async def toggle_provider(
    provider_id: str,
    settings: SettingsDep,
    registry: ProviderRegistryDep,
    body: ProviderToggleUpdate | None = None,
) -> ProviderInfo:
    """Enable or disable a provider. Disabled providers keep their key but aren't used.

    If ``enabled`` is provided, the operation is idempotent. Without a body, the
    endpoint keeps the legacy toggle behavior for older clients.
    """
    pdef = PROVIDER_CATALOG.get(provider_id)
    if not pdef:
        raise HTTPException(404, f"Unknown provider: {provider_id}")
    disabled = _get_disabled_set(settings)

    api_key = getattr(settings, pdef.settings_key, "")
    is_currently_disabled = provider_id in disabled
    target_enabled = body.enabled if body and body.enabled is not None else is_currently_disabled

    if target_enabled:
        # Enable: remove from disabled list, register provider if needed.
        disabled.discard(provider_id)
        provider = registry.get_provider(provider_id)
        if api_key and provider is None:
            try:
                extra_kwargs: dict[str, str] = {}
                if pdef.kind == "openai_compat_azure":
                    azure_url = getattr(settings, "azure_openai_base_url", "")
                    if azure_url:
                        extra_kwargs["base_url"] = azure_url
                provider = create_desktop_provider(provider_id, api_key, **extra_kwargs)
                registry.register(provider)
                await registry.refresh_models()
            except Exception as e:
                logger.warning("Failed to enable provider %s: %s", provider_id, e)
    else:
        # Disable: add to disabled list, unregister provider
        disabled.add(provider_id)
        registry.unregister(provider_id)

    # Persist disabled list
    settings.disabled_providers = ",".join(sorted(disabled))
    _update_env_file("WORKCRAFT_DISABLED_PROVIDERS", settings.disabled_providers)

    # Build response
    provider = registry.get_provider(provider_id)
    new_enabled = provider_id not in disabled
    if new_enabled and provider and api_key:
        models = [m for p, m in registry._full_models if m.provider_id == provider_id]
        return ProviderInfo(
            id=provider_id, name=pdef.name, is_configured=True, enabled=True,
            masked_key=_mask_key(api_key), model_count=len(models), status="connected",
        )
    elif api_key and not new_enabled:
        return ProviderInfo(
            id=provider_id, name=pdef.name, is_configured=True, enabled=False,
            masked_key=_mask_key(api_key), status="disabled",
        )
    else:
        return ProviderInfo(
            id=provider_id, name=pdef.name, is_configured=bool(api_key),
            enabled=new_enabled, status="unconfigured",
        )


@router.post("/config/custom/test", response_model=ProviderTestResult)
async def test_custom_endpoint(body: CustomEndpointCreate) -> ProviderTestResult:
    """Validate a custom endpoint without saving it."""
    endpoint_id = f"custom_test_{uuid.uuid4().hex[:8]}"
    api_key = body.api_key.strip() if body.api_key else ""
    model_count, models = await _validate_provider_connection(
        endpoint_id,
        api_key,
        base_url=body.base_url,
    )
    return ProviderTestResult(model_count=model_count, models=models)


@router.post("/config/custom", response_model=ProviderInfo)
async def create_custom_endpoint(
    body: CustomEndpointCreate, settings: SettingsDep, registry: ProviderRegistryDep
) -> ProviderInfo:
    """Create a new custom endpoint."""
    base_url = body.base_url
    api_key = body.api_key.strip() if body.api_key else ""
    name = body.name.strip() or "Custom Endpoint"
    enabled = body.enabled

    endpoint_id = f"custom_{uuid.uuid4().hex[:8]}"

    model_count, _ = await _validate_provider_connection(endpoint_id, api_key, base_url=base_url)
    test_provider = create_desktop_provider(endpoint_id, api_key, base_url=base_url)

    async with _custom_endpoints_lock:
        endpoints = get_custom_endpoints(settings)
        new_config = {
            "id": endpoint_id,
            "name": name,
            "base_url": base_url,
            "api_key": api_key,
            "enabled": enabled,
        }
        endpoints.append(new_config)

        settings.custom_endpoints = json.dumps(endpoints)
        _update_env_file("WORKCRAFT_CUSTOM_ENDPOINTS", settings.custom_endpoints)

    if enabled:
        registry.register(test_provider)
        try:
            await registry.refresh_models()
        except Exception as e:
            logger.warning("Failed to refresh models after adding custom endpoint %s: %s", endpoint_id, e)

    return ProviderInfo(
        id=endpoint_id,
        name=name,
        is_configured=True,
        enabled=enabled,
        masked_key=_mask_key(api_key) if api_key else None,
        model_count=model_count if enabled else 0,
        status="connected" if enabled else "disabled",
        base_url=base_url,
    )


@router.delete("/config/custom/{endpoint_id}", response_model=ProviderInfo)
async def delete_custom_endpoint(
    endpoint_id: str, settings: SettingsDep, registry: ProviderRegistryDep
) -> ProviderInfo:
    async with _custom_endpoints_lock:
        endpoints = get_custom_endpoints(settings)
        found = None
        for i, e in enumerate(endpoints):
            if e.get("id") == endpoint_id:
                found = endpoints.pop(i)
                break

        if not found:
            raise HTTPException(404, "Custom endpoint not found")

        settings.custom_endpoints = json.dumps(endpoints)
        _update_env_file("WORKCRAFT_CUSTOM_ENDPOINTS", settings.custom_endpoints)

    registry.unregister(endpoint_id)

    return ProviderInfo(
        id=endpoint_id, name=found.get("name", "Custom Endpoint"),
        is_configured=False, status="unconfigured"
    )

@router.patch("/config/custom/{endpoint_id}", response_model=ProviderInfo)
async def update_custom_endpoint(
    endpoint_id: str,
    body: CustomEndpointUpdate,
    settings: SettingsDep,
    registry: ProviderRegistryDep,
) -> ProviderInfo:
    """Update a custom endpoint (partial update)."""
    models: list = []
    test_provider = None
    needs_rebuild = body.base_url is not None or body.api_key is not None

    # --- Phase 1: read current config (under lock) ---
    async with _custom_endpoints_lock:
        endpoints = get_custom_endpoints(settings)

        found = None
        found_idx = -1
        for i, e in enumerate(endpoints):
            if e.get("id") == endpoint_id:
                found = e
                found_idx = i
                break

        if not found:
            raise HTTPException(404, "Custom endpoint not found")

    name = body.name.strip() if body.name is not None else found.get("name", "Custom Endpoint")
    base_url = body.base_url if body.base_url is not None else found.get("base_url", "")
    api_key = body.api_key.strip() if body.api_key is not None else found.get("api_key", "")
    enabled = body.enabled if body.enabled is not None else found.get("enabled", True)

    # --- Phase 2: validate (outside lock — network I/O) ---
    if needs_rebuild:
        try:
            test_provider = create_desktop_provider(endpoint_id, api_key, base_url=base_url)
            models = await test_provider.list_models()
        except Exception as e:
            logger.warning("Failed validation for custom endpoint %s: %s", name, e)
            raise HTTPException(400, f"Validation failed: {e}")
    else:
        provider = registry.get_provider(endpoint_id)
        models = [m for p, m in registry._full_models if m.provider_id == endpoint_id] if provider else []

    # --- Phase 3: persist (under lock) ---
    async with _custom_endpoints_lock:
        # Re-read in case another request mutated while we validated.
        endpoints = get_custom_endpoints(settings)
        found_idx = next((i for i, e in enumerate(endpoints) if e.get("id") == endpoint_id), -1)
        if found_idx == -1:
            raise HTTPException(404, "Custom endpoint was deleted during update")

        updated_config = {
            "id": endpoint_id,
            "name": name,
            "base_url": base_url,
            "api_key": api_key,
            "enabled": enabled,
        }
        endpoints[found_idx] = updated_config

        settings.custom_endpoints = json.dumps(endpoints)
        _update_env_file("WORKCRAFT_CUSTOM_ENDPOINTS", settings.custom_endpoints)

    if enabled and needs_rebuild and test_provider is not None:
        registry.unregister(endpoint_id)
        registry.register(test_provider)
        try:
            await registry.refresh_models()
        except Exception as e:
            logger.warning("Failed to refresh models after updating custom endpoint %s: %s", endpoint_id, e)
    elif not enabled:
        registry.unregister(endpoint_id)

    return ProviderInfo(
        id=endpoint_id, name=name, is_configured=True, enabled=enabled,
        masked_key=_mask_key(api_key) if api_key else None,
        model_count=len(models), status="connected" if enabled else "disabled", base_url=base_url
    )

# ── Local OpenAI-compatible endpoint ────────────────────────────────────────

@router.get("/config/local", response_model=LocalProviderStatus)
async def get_local_provider(settings: SettingsDep, registry: ProviderRegistryDep) -> LocalProviderStatus:
    """Return the stored local endpoint configuration."""
    return _local_provider_status(settings, registry)


@router.post("/config/local", response_model=LocalProviderStatus)
async def set_local_provider(
    settings: SettingsDep, registry: ProviderRegistryDep, body: LocalProviderUpdate,
) -> LocalProviderStatus:
    """Register a locally-hosted OpenAI-compatible endpoint."""
    base_url = _normalize_local_base_url(body.base_url)
    try:
        test_provider = create_local_provider(base_url)
        models = await test_provider.list_models()
        if not models:
            raise HTTPException(400, "Local endpoint returned no models")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Local provider validation failed for %s: %s", base_url, e)
        raise HTTPException(400, f"Local endpoint validation failed: {e}")
    registry.unregister(LOCAL_PROVIDER_ID)
    registry.register(create_local_provider(base_url))

    try:
        await registry.refresh_models()
    except Exception as e:
        logger.warning("Model refresh failed after local provider registration: %s", e)

    _update_env_file(LOCAL_BASE_URL_ENV, base_url)
    settings.local_base_url = base_url

    return LocalProviderStatus(
        base_url=base_url,
        is_configured=True,
        is_connected=True,
        status="connected",
    )


@router.delete("/config/local", response_model=LocalProviderStatus)
async def delete_local_provider(settings: SettingsDep, registry: ProviderRegistryDep) -> LocalProviderStatus:
    """Remove the local endpoint configuration."""
    settings.local_base_url = ""
    _remove_env_key(LOCAL_BASE_URL_ENV)

    registry.unregister(LOCAL_PROVIDER_ID)

    try:
        await registry.refresh_models()
    except Exception as e:
        logger.warning("Model refresh failed after removing local provider: %s", e)

    return LocalProviderStatus()
