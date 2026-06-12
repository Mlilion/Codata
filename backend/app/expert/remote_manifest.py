"""Remote expert team manifest loader and cache fetcher."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field

from app.expert.models import ExpertTeamConfig
from app.expert.validation import validate_expert_team_config

logger = logging.getLogger(__name__)

REMOTE_MANIFEST_SCHEMA_VERSION = "1.0"
DEFAULT_REMOTE_FETCH_TIMEOUT_SECONDS = 10.0
DEFAULT_REMOTE_FETCH_MIN_INTERVAL_SECONDS = 60.0


class RemoteExpertTeamLicense(BaseModel):
    """Authorization metadata for a remote expert team."""

    model_config = ConfigDict(extra="ignore")

    status: str = "active"
    features: list[str] = Field(default_factory=list)
    expires_at: str | None = None


class RemoteExpertTeamVisibility(BaseModel):
    """Catalog visibility metadata for a remote expert team."""

    model_config = ConfigDict(extra="ignore")

    listed: bool = True
    category: str | None = None
    tags: list[str] = Field(default_factory=list)


class RemoteExpertTeamEntry(BaseModel):
    """One team entry inside a remote expert team manifest."""

    model_config = ConfigDict(extra="ignore")

    remote_id: str = Field(..., min_length=1)
    runtime_id: str | None = None
    version: str = "1.0.0"
    channel: str = "stable"
    license: RemoteExpertTeamLicense = Field(default_factory=RemoteExpertTeamLicense)
    visibility: RemoteExpertTeamVisibility = Field(default_factory=RemoteExpertTeamVisibility)
    team: ExpertTeamConfig


class RemoteExpertTeamsManifest(BaseModel):
    """Versioned manifest document delivered by a future expert team service."""

    model_config = ConfigDict(extra="ignore")

    schema_version: str = REMOTE_MANIFEST_SCHEMA_VERSION
    tenant_id: str = "workcraft"
    account_id: str | None = None
    generated_at: str | None = None
    expires_at: str | None = None
    etag: str | None = None
    teams: list[Any] = Field(default_factory=list)


@dataclass(frozen=True)
class LoadedRemoteExpertTeam:
    """A validated remote team plus registry metadata."""

    team: ExpertTeamConfig
    metadata: dict[str, Any]


@dataclass(frozen=True)
class RemoteManifestCacheResult:
    """Result of refreshing a remote manifest cache file."""

    cache_path: Path
    updated: bool = False
    available: bool = False
    not_modified: bool = False
    error: str | None = None


def load_remote_expert_teams(path: Path) -> list[LoadedRemoteExpertTeam]:
    """Load validated remote expert teams from a manifest JSON file."""

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Manifest root must be an object")

    manifest = RemoteExpertTeamsManifest.model_validate(raw)
    if manifest.schema_version != REMOTE_MANIFEST_SCHEMA_VERSION:
        raise ValueError(
            f"Unsupported remote expert team manifest schema: {manifest.schema_version}"
        )
    if _is_expired(manifest.expires_at):
        logger.warning("Remote expert team manifest expired: %s", path)
        return []

    loaded: list[LoadedRemoteExpertTeam] = []
    for index, raw_entry in enumerate(manifest.teams):
        try:
            if not isinstance(raw_entry, dict):
                raise ValueError("Manifest team entry must be an object")
            entry = RemoteExpertTeamEntry.model_validate(raw_entry)
            remote_team = _build_remote_team(path, manifest, entry)
        except Exception as exc:
            remote_id = raw_entry.get("remote_id") if isinstance(raw_entry, dict) else None
            remote_id = remote_id or f"index:{index}"
            logger.warning("Skipping remote expert team %s: %s", remote_id, exc)
            continue
        if remote_team is not None:
            loaded.append(remote_team)
    return loaded


def refresh_remote_manifest_cache(
    *,
    url: str,
    cache_path: Path,
    token: str = "",
    timeout_seconds: float = DEFAULT_REMOTE_FETCH_TIMEOUT_SECONDS,
    min_interval_seconds: float = DEFAULT_REMOTE_FETCH_MIN_INTERVAL_SECONDS,
    force: bool = False,
) -> RemoteManifestCacheResult:
    """Fetch a remote manifest URL into a local cache file.

    Network failures keep the existing cache usable. The registry consumes only
    the cache file, so the rest of the expert-team loading path stays identical
    to local manifest loading.
    """

    url = url.strip()
    if not url:
        return RemoteManifestCacheResult(cache_path=cache_path, error="Remote manifest URL is empty")

    cache_path = cache_path.expanduser()
    now = time.time()
    meta = _read_cache_meta(cache_path)
    fetched_at = _as_float(meta.get("fetched_at"))
    if (
        not force
        and fetched_at is not None
        and now - fetched_at < min_interval_seconds
        and cache_path.is_file()
    ):
        return RemoteManifestCacheResult(cache_path=cache_path, available=True)

    headers: dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    etag = _read_cached_etag(cache_path, meta)
    if etag:
        headers["If-None-Match"] = etag

    try:
        with httpx.Client(timeout=timeout_seconds, follow_redirects=True) as client:
            response = client.get(url, headers=headers)
    except Exception as exc:
        logger.warning("Failed to fetch remote expert team manifest %s: %s", url, exc)
        return RemoteManifestCacheResult(
            cache_path=cache_path,
            available=cache_path.is_file(),
            error=str(exc),
        )

    if response.status_code == 304:
        _write_cache_meta(
            cache_path,
            {
                **meta,
                "url": url,
                "etag": etag,
                "fetched_at": now,
                "status_code": response.status_code,
            },
        )
        return RemoteManifestCacheResult(
            cache_path=cache_path,
            available=cache_path.is_file(),
            not_modified=True,
        )

    if response.status_code >= 400:
        logger.warning(
            "Remote expert team manifest fetch failed: %s returned HTTP %s",
            url,
            response.status_code,
        )
        return RemoteManifestCacheResult(
            cache_path=cache_path,
            available=cache_path.is_file(),
            error=f"HTTP {response.status_code}",
        )

    try:
        payload = response.json()
        manifest = RemoteExpertTeamsManifest.model_validate(payload)
        if manifest.schema_version != REMOTE_MANIFEST_SCHEMA_VERSION:
            raise ValueError(
                f"Unsupported remote expert team manifest schema: {manifest.schema_version}"
            )
    except Exception as exc:
        logger.warning("Remote expert team manifest response is invalid: %s", exc)
        return RemoteManifestCacheResult(
            cache_path=cache_path,
            available=cache_path.is_file(),
            error=str(exc),
        )

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)
    _atomic_write(cache_path, serialized + "\n")
    _write_cache_meta(
        cache_path,
        {
            "url": url,
            "etag": response.headers.get("etag") or manifest.etag,
            "manifest_etag": manifest.etag,
            "fetched_at": now,
            "status_code": response.status_code,
        },
    )
    logger.info("Fetched remote expert team manifest from %s into %s", url, cache_path)
    return RemoteManifestCacheResult(cache_path=cache_path, updated=True, available=True)


def _build_remote_team(
    path: Path,
    manifest: RemoteExpertTeamsManifest,
    entry: RemoteExpertTeamEntry,
) -> LoadedRemoteExpertTeam | None:
    if not entry.visibility.listed:
        return None

    license_status = entry.license.status.lower()
    if license_status != "active":
        logger.info(
            "Skipping remote expert team %s because license status is %s",
            entry.remote_id,
            entry.license.status,
        )
        return None
    if _is_expired(entry.license.expires_at):
        logger.info("Skipping expired remote expert team %s", entry.remote_id)
        return None

    runtime_id = entry.runtime_id or entry.team.id
    team_data = entry.team.model_dump(mode="python")
    team_data["id"] = runtime_id
    if entry.visibility.category:
        team_data["category"] = entry.visibility.category
    if entry.visibility.tags:
        team_data["tags"] = _merge_unique([*entry.team.tags, *entry.visibility.tags])

    remote_metadata = {
        "origin": "remote",
        "remote_id": entry.remote_id,
        "runtime_id": runtime_id,
        "remote_version": entry.version,
        "remote_channel": entry.channel,
        "tenant_id": manifest.tenant_id,
        "account_id": manifest.account_id,
        "manifest_etag": manifest.etag,
        "license_features": entry.license.features,
    }
    team_data["metadata"] = {
        **dict(entry.team.metadata),
        **{key: value for key, value in remote_metadata.items() if value is not None},
    }
    team = ExpertTeamConfig(**team_data)

    errors = validate_expert_team_config(team)
    if errors:
        raise ValueError("; ".join(errors))

    source = f"remote:{path}#{entry.remote_id}@{entry.version}"
    registry_metadata = {
        "is_preset": False,
        "editable": False,
        "origin": "remote",
        "remote": True,
        "source": source,
        **{key: value for key, value in remote_metadata.items() if value is not None},
    }
    return LoadedRemoteExpertTeam(team=team, metadata=registry_metadata)


def _is_expired(value: str | None) -> bool:
    if not value:
        return False
    try:
        expires_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        logger.warning("Ignoring invalid remote expert team expiry timestamp: %s", value)
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at <= datetime.now(timezone.utc)


def _merge_unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _cache_meta_path(cache_path: Path) -> Path:
    return cache_path.with_name(f"{cache_path.name}.meta.json")


def _read_cache_meta(cache_path: Path) -> dict[str, Any]:
    meta_path = _cache_meta_path(cache_path)
    if not meta_path.is_file():
        return {}
    try:
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def _write_cache_meta(cache_path: Path, payload: dict[str, Any]) -> None:
    meta_path = _cache_meta_path(cache_path)
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write(meta_path, json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def _read_cached_etag(cache_path: Path, meta: dict[str, Any]) -> str | None:
    etag = meta.get("etag")
    if isinstance(etag, str) and etag:
        return etag
    if not cache_path.is_file():
        return None
    try:
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if isinstance(raw, dict) and isinstance(raw.get("etag"), str):
        return raw["etag"]
    return None


def _atomic_write(path: Path, content: str) -> None:
    temp_path = path.with_name(f".{path.name}.tmp")
    temp_path.write_text(content, encoding="utf-8")
    temp_path.replace(path)


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
