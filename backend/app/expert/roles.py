"""Role library support for expert teams.

The registry understands the markdown role files used by agency-agents and
agency-agents-zh. It intentionally treats the files as data: frontmatter is
parsed for catalog metadata, and the markdown body becomes the expert system
prompt.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

_ROLE_PATH_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_\-/]*$")
_FRONTMATTER_RE = re.compile(r"^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$")


class ExpertRole(BaseModel):
    """A single role definition loaded from a markdown role library."""

    id: str
    name: str
    description: str = ""
    category: str = "general"
    emoji: str | None = None
    tools: str | None = None
    source: str
    system_prompt: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExpertRoleListResponse(BaseModel):
    """Response for listing expert role library entries."""

    roles: list[ExpertRole]
    source_dirs: list[str]
    preferred_language: str = "zh"
    active_language: str = "none"
    using_fallback: bool = False
    missing_preferred_dirs: list[str] = Field(default_factory=list)


class ExpertRoleRegistry:
    """Loads role markdown files from known agency-agents directories."""

    def __init__(
        self,
        *,
        dirs: list[Path] | None = None,
        project_dir: str | None = None,
    ) -> None:
        self._dirs = dirs or self._default_dirs(project_dir)
        self._roles: dict[str, ExpertRole] = {}
        self._source_dirs: list[Path] = []
        self._missing_preferred_dirs: list[Path] = []
        self._active_language = "none"

    @property
    def source_dirs(self) -> list[str]:
        return [str(path) for path in self._source_dirs]

    @property
    def missing_preferred_dirs(self) -> list[str]:
        return [str(path) for path in self._missing_preferred_dirs]

    @property
    def active_language(self) -> str:
        return self._active_language

    @property
    def using_fallback(self) -> bool:
        return self._active_language not in {"none", "zh"}

    def scan(self) -> None:
        """Scan all configured role library directories."""
        self._roles.clear()
        self._source_dirs.clear()
        self._missing_preferred_dirs.clear()
        self._active_language = "none"
        for directory in self._dirs:
            root = directory.expanduser().resolve()
            if not root.is_dir():
                if self._is_zh_library(root) and self._active_language != "zh":
                    self._missing_preferred_dirs.append(root)
                continue
            is_zh = self._is_zh_library(root)
            if self._active_language == "zh" and not is_zh:
                continue
            before = len(self._roles)
            self._source_dirs.append(root)
            for path in sorted(root.rglob("*.md")):
                if self._skip_path(root, path):
                    continue
                role_id = path.relative_to(root).with_suffix("").as_posix()
                if not self._valid_role_path(role_id):
                    continue
                try:
                    role = self._load_role(root, path, role_id)
                except Exception:
                    continue
                self._roles.setdefault(role.id, role)
            if len(self._roles) > before:
                language = "zh" if is_zh else "en"
                if self._active_language == "none":
                    self._active_language = language
                elif self._active_language != language:
                    self._active_language = "mixed"
                if language == "zh":
                    self._missing_preferred_dirs.clear()

    def list_roles(self) -> list[ExpertRole]:
        """Return roles sorted for catalog display."""
        return sorted(self._roles.values(), key=lambda role: (role.category, role.name, role.id))

    def get(self, role_id: str) -> ExpertRole | None:
        if not self._valid_role_path(role_id):
            return None
        return self._roles.get(role_id)

    def get_or_raise(self, role_id: str) -> ExpertRole:
        role = self.get(role_id)
        if role is None:
            raise KeyError(role_id)
        return role

    def refresh(self) -> None:
        self.scan()

    @staticmethod
    def _default_dirs(project_dir: str | None) -> list[Path]:
        dirs: list[Path] = []
        env_dir = os.getenv("WORKCRAFT_AGENTS_DIR")
        if env_dir:
            dirs.append(Path(env_dir))
        repo_root = Path(__file__).resolve().parents[3]
        app_data_dir = Path(__file__).resolve().parents[1] / "data"
        if project_dir:
            project = Path(project_dir)
            dirs.extend([
                project / ".workcraft" / "agency-agents-zh",
                project / "agency-agents-zh",
                project / "node_modules" / "agency-agents-zh",
            ])
        dirs.extend([
            app_data_dir / "agency-agents-zh",
            repo_root / "node_modules" / "agency-agents-zh",
            repo_root / "agency-agents-zh",
            Path.home() / ".workcraft" / "agency-agents-zh",
            Path.home() / "agency-agents-zh",
        ])
        if project_dir:
            project = Path(project_dir)
            dirs.extend([
                project / ".workcraft" / "agency-agents",
                project / "agency-agents",
                project / "node_modules" / "agency-agents",
            ])
        dirs.extend([
            app_data_dir / "agency-agents",
            repo_root / "node_modules" / "agency-agents",
            repo_root / "agency-agents",
            Path.home() / ".workcraft" / "agency-agents",
            Path.home() / "agency-agents",
        ])
        return list(dict.fromkeys(dirs))

    @staticmethod
    def _is_zh_library(path: Path) -> bool:
        return "agency-agents-zh" in path.parts

    @staticmethod
    def _valid_role_path(role_id: str) -> bool:
        return bool(_ROLE_PATH_RE.match(role_id)) and ".." not in role_id.split("/")

    @staticmethod
    def _skip_path(root: Path, path: Path) -> bool:
        rel_parts = path.relative_to(root).parts
        return any(
            part.startswith(".")
            or part in {"node_modules", "scripts", "integrations", "examples", "docs"}
            for part in rel_parts
        )

    @classmethod
    def _load_role(cls, root: Path, path: Path, role_id: str) -> ExpertRole:
        full_path = path.resolve()
        if not str(full_path).startswith(str(root)):
            raise ValueError("Role path is outside role library")
        content = path.read_text(encoding="utf-8")
        metadata: dict[str, Any] = {}
        body = content
        match = _FRONTMATTER_RE.match(content)
        if not match:
            raise ValueError("Role file must include YAML frontmatter")
        parsed = yaml.safe_load(match.group(1)) or {}
        if isinstance(parsed, dict):
            metadata = {str(key): value for key, value in parsed.items()}
        body = match.group(2)

        category = role_id.split("/", 1)[0] if "/" in role_id else "general"
        name = str(metadata.get("name") or role_id.rsplit("/", 1)[-1])
        description = str(metadata.get("description") or "")
        emoji = metadata.get("emoji")
        tools = metadata.get("tools")
        return ExpertRole(
            id=role_id,
            name=name,
            description=description,
            category=category,
            emoji=str(emoji) if emoji is not None else None,
            tools=str(tools) if tools is not None else None,
            source=str(path),
            system_prompt=body.strip(),
            metadata=metadata,
        )
