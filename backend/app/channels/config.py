"""Channel configuration schema for WorkCraft.

Replaces the nanobot Config dependency with a lightweight schema
that reads from WorkCraft's data/channels.json.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Default path for channels configuration
_DEFAULT_CONFIG_PATH = Path("data/channels.json")


def resolve_channels_config_path(config_path: str | Path | None = None) -> Path:
    """Return the canonical channels config path.

    Relative paths are resolved by the caller's current working directory,
    matching the rest of the backend's data-file settings.
    """
    if config_path:
        value = Path(config_path).expanduser()
        if str(value).strip():
            return value
    return _DEFAULT_CONFIG_PATH


class ChannelsConfig(BaseModel):
    """Top-level channels configuration."""

    # Per-channel configs stored as dicts (flexible schema per channel)
    # e.g. {"telegram": {"enabled": true, "token": "...", "allow_from": ["*"]}, ...}
    channels: dict[str, dict[str, Any]] = Field(default_factory=dict)

    # Global settings
    send_progress: bool = True
    send_tool_hints: bool = True
    send_max_retries: int = 3


def load_channels_config(config_path: Path | None = None) -> ChannelsConfig:
    """Load channels configuration from JSON file."""
    path = resolve_channels_config_path(config_path)
    if not path.exists():
        logger.info("No channels config at %s — using defaults", path)
        return ChannelsConfig()

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return ChannelsConfig.model_validate(data)
    except Exception as e:
        logger.warning("Failed to load channels config from %s: %s", path, e)
        return ChannelsConfig()


def save_channels_config(config: ChannelsConfig, config_path: Path | None = None) -> None:
    """Save channels configuration to JSON file."""
    path = resolve_channels_config_path(config_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(config.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info("Saved channels config to %s", path)
