"""Expert team registry backed by YAML presets and user config files."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from app.expert.models import ExpertTeamConfig, ExpertTeamSummary
from app.expert.remote_manifest import load_remote_expert_teams, refresh_remote_manifest_cache
from app.expert.validation import validate_expert_team_config

logger = logging.getLogger(__name__)

PRESETS_DIR = Path(__file__).parent / "presets"
DEFAULT_REMOTE_MANIFEST_PATH = Path.home() / ".workcraft" / "remote-expert-teams" / "manifest.json"
DEFAULT_REMOTE_MANIFEST_CACHE_PATH = (
    Path.home() / ".workcraft" / "remote-expert-teams" / "cache" / "manifest.json"
)


class ExpertTeamRegistry:
    """Single source of truth for available expert teams."""

    def __init__(
        self,
        *,
        presets_dir: Path | None = None,
        project_dir: str | None = None,
        user_dir: Path | None = None,
        remote_enabled: bool = False,
        remote_manifest_path: str | Path | None = None,
        remote_manifest_url: str = "",
        remote_auth_token: str = "",
        remote_cache_path: str | Path | None = None,
        remote_fetch_interval_seconds: int = 60,
    ) -> None:
        self._presets_dir = presets_dir or PRESETS_DIR
        self._project_dir = project_dir
        self._user_dir = user_dir or Path.home() / ".workcraft" / "expert-teams"
        self._remote_enabled = remote_enabled
        self._remote_manifest_url = remote_manifest_url.strip()
        self._remote_auth_token = remote_auth_token
        self._remote_manifest_path = (
            Path(remote_manifest_path).expanduser()
            if remote_manifest_path
            else DEFAULT_REMOTE_MANIFEST_PATH
        )
        self._remote_cache_path = (
            Path(remote_cache_path).expanduser()
            if remote_cache_path
            else DEFAULT_REMOTE_MANIFEST_CACHE_PATH
        )
        self._remote_fetch_interval_seconds = remote_fetch_interval_seconds
        self._remote_manifest_snapshot: tuple[bool, int, int] | None = None
        self._teams: dict[str, ExpertTeamConfig] = {}
        self._metadata: dict[str, dict[str, Any]] = {}

    def scan(self) -> None:
        """Load preset, user-defined, project, and optional remote expert teams."""
        self._teams.clear()
        self._metadata.clear()
        self._scan_dir(self._presets_dir, is_preset=True, origin="preset")

        self._scan_dir(self._user_dir, is_preset=False, origin="user")

        if self._project_dir:
            project_dir = Path(self._project_dir).resolve() / ".workcraft" / "expert-teams"
            self._scan_dir(project_dir, is_preset=False, origin="project")

        self._scan_remote_manifest()
        self._remote_manifest_snapshot = self._remote_snapshot()

        logger.info("Discovered %d expert team(s)", len(self._teams))

    def list_teams(self) -> list[ExpertTeamSummary]:
        """Return all available teams for catalog display."""
        self.refresh_remote_if_changed()
        result: list[ExpertTeamSummary] = []
        for team_id, config in self._teams.items():
            meta = self._metadata.get(team_id, {})
            result.append(
                ExpertTeamSummary(
                    id=team_id,
                    name=config.name,
                    description=config.description,
                    icon=config.icon,
                    process=config.process,
                    tags=config.tags,
                    category=config.category,
                    member_count=len(config.members),
                    task_count=len(config.tasks),
                    is_preset=bool(meta.get("is_preset")),
                    editable=self._is_editable(meta),
                    origin=str(meta.get("origin") or ("preset" if meta.get("is_preset") else "user")),
                    source=meta.get("source"),
                    remote_id=meta.get("remote_id"),
                    remote_version=meta.get("remote_version"),
                    remote_channel=meta.get("remote_channel"),
                    members=[
                        {"id": member.id, "name": member.name, "role": member.role, "icon": member.icon}
                        for member in config.members
                    ],
                )
            )
        return sorted(result, key=lambda item: (not item.is_preset, item.category, item.name))

    def get(self, team_id: str) -> ExpertTeamConfig | None:
        self.refresh_remote_if_changed()
        return self._teams.get(team_id)

    def metadata(self, team_id: str) -> dict[str, Any]:
        self.refresh_remote_if_changed()
        return dict(self._metadata.get(team_id, {}))

    def get_or_raise(self, team_id: str) -> ExpertTeamConfig:
        team = self.get(team_id)
        if team is None:
            raise KeyError(team_id)
        return team

    def register(
        self,
        config: ExpertTeamConfig,
        *,
        is_preset: bool = False,
        source: str = "",
        editable: bool | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        errors = validate_expert_team_config(config)
        if errors:
            raise ValueError("; ".join(errors))
        self._teams[config.id] = config
        item_metadata = {
            "is_preset": is_preset,
            "editable": (not is_preset) if editable is None else editable,
            "origin": "preset" if is_preset else "user",
            "source": source,
        }
        if metadata:
            item_metadata.update(metadata)
        self._metadata[config.id] = item_metadata

    def save_user_team(self, config: ExpertTeamConfig) -> ExpertTeamConfig:
        """Create or update a user-defined team and persist it as YAML."""
        existing = self._metadata.get(config.id)
        if existing and existing.get("is_preset"):
            raise ValueError("Preset expert teams cannot be modified")
        if existing and not self._is_editable(existing):
            raise ValueError("This expert team cannot be modified")

        self._user_dir.mkdir(parents=True, exist_ok=True)
        path = self._user_dir / f"{config.id}.yaml"
        self._write_yaml(path, config)
        self.register(config, is_preset=False, source=str(path))
        return config

    def delete_user_team(self, team_id: str) -> bool:
        """Delete a user-defined expert team."""
        meta = self._metadata.get(team_id)
        if not meta:
            return False
        if meta.get("is_preset"):
            raise ValueError("Preset expert teams cannot be deleted")
        if not self._is_editable(meta):
            raise ValueError("This expert team cannot be deleted")

        source = meta.get("source")
        if source:
            Path(source).unlink(missing_ok=True)
        self._teams.pop(team_id, None)
        self._metadata.pop(team_id, None)
        return True

    def refresh_remote_if_changed(self) -> bool:
        """Reload registry when the configured remote manifest source changes."""
        if not self._remote_enabled:
            return False
        if self._remote_manifest_url:
            refresh_remote_manifest_cache(
                url=self._remote_manifest_url,
                cache_path=self._remote_cache_path,
                token=self._remote_auth_token,
                min_interval_seconds=self._remote_fetch_interval_seconds,
            )
        snapshot = self._remote_snapshot()
        if snapshot == self._remote_manifest_snapshot:
            return False
        logger.info("Remote expert team manifest changed; rescanning registry")
        self.scan()
        return True

    def _scan_dir(self, directory: Path, *, is_preset: bool, origin: str) -> None:
        if not directory.is_dir():
            return
        for path in sorted([*directory.glob("*.yaml"), *directory.glob("*.yml")]):
            try:
                config = self._load_yaml(path)
            except Exception as exc:
                logger.warning("Failed to load expert team %s: %s", path, exc)
                continue
            self.register(config, is_preset=is_preset, source=str(path), metadata={"origin": origin})

    def _scan_remote_manifest(self) -> None:
        if not self._remote_enabled:
            return
        path = self._remote_effective_manifest_path()
        if self._remote_manifest_url:
            refresh_remote_manifest_cache(
                url=self._remote_manifest_url,
                cache_path=path,
                token=self._remote_auth_token,
                min_interval_seconds=self._remote_fetch_interval_seconds,
                force=True,
            )
        if not path.is_file():
            logger.info("Remote expert team manifest not found: %s", path)
            return
        try:
            remote_teams = load_remote_expert_teams(path)
        except Exception as exc:
            logger.warning("Failed to load remote expert team manifest %s: %s", path, exc)
            return

        loaded_count = 0
        for item in remote_teams:
            if item.team.id in self._teams:
                logger.warning(
                    "Skipping remote expert team %s because id already exists",
                    item.team.id,
                )
                continue
            self.register(
                item.team,
                is_preset=False,
                source=str(item.metadata.get("source") or path),
                editable=False,
                metadata=item.metadata,
            )
            loaded_count += 1
        if loaded_count:
            logger.info("Loaded %d remote expert team(s) from %s", loaded_count, path)

    def _remote_snapshot(self) -> tuple[bool, int, int] | None:
        if not self._remote_enabled:
            return None
        try:
            stat = self._remote_effective_manifest_path().stat()
        except FileNotFoundError:
            return (False, 0, 0)
        return (True, stat.st_mtime_ns, stat.st_size)

    def _remote_effective_manifest_path(self) -> Path:
        if self._remote_manifest_url:
            return self._remote_cache_path
        return self._remote_manifest_path

    @staticmethod
    def _is_editable(meta: dict[str, Any]) -> bool:
        return bool(meta.get("editable", not bool(meta.get("is_preset"))))

    @staticmethod
    def _load_yaml(path: Path) -> ExpertTeamConfig:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict):
            raise ValueError("YAML root must be an object")
        data = raw.get("team", raw)
        if not isinstance(data, dict):
            raise ValueError("team must be an object")
        if "id" not in data:
            data = {**data, "id": path.stem}
        return ExpertTeamConfig(**data)

    @staticmethod
    def _write_yaml(path: Path, config: ExpertTeamConfig) -> None:
        payload = {"team": config.model_dump(mode="json")}
        path.write_text(
            yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
