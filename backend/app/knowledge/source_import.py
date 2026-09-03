"""Helpers for importing local files into the knowledge base."""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

from app.api.files import UPLOAD_DIR
from app.knowledge.ingest import ingest_entry
from app.models.knowledge_entry import KnowledgeEntry
from app.tool.extractors import is_supported_binary
from app.tool.workspace import WorkspaceViolation, resolve_and_validate
from app.utils.id import generate_ulid

_TEXT_EXTS = {".md", ".markdown", ".txt"}


def is_supported_knowledge_source(name: str) -> bool:
    ext = Path(name).suffix.lower()
    return ext in _TEXT_EXTS or is_supported_binary(name)


async def register_file_entry(
    session_factory,
    *,
    stored_path: str | Path,
    source_name: str,
    title: str,
    note: str = "",
) -> KnowledgeEntry:
    """Persist a knowledge entry for a file already copied into uploads."""
    path = Path(stored_path).resolve()
    async with session_factory() as session:
        entry = KnowledgeEntry(
            source_type="file",
            file_path=str(path),
            source_name=source_name,
            title=title,
            note=note.strip(),
        )
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
        return entry


async def import_local_file(
    session_factory,
    *,
    file_path: str,
    workspace: str | None = None,
    title: str | None = None,
    note: str | None = None,
) -> KnowledgeEntry:
    """Copy a workspace file into uploads and register it as knowledge."""
    if not workspace:
        raise ValueError("workspace is required to import local files")
    try:
        resolved = resolve_and_validate(file_path, workspace)
    except WorkspaceViolation as exc:
        raise ValueError(str(exc)) from exc
    source = Path(resolved)
    if not source.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    if source.is_dir():
        raise IsADirectoryError(f"Cannot import a directory: {file_path}")
    if not is_supported_knowledge_source(source.name):
        raise ValueError(f"Unsupported knowledge file type: {source.name}")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe = source.name
    dest = UPLOAD_DIR / f"{generate_ulid()}_{safe}"
    await asyncio.to_thread(shutil.copy2, source, dest)

    return await register_file_entry(
        session_factory,
        stored_path=dest,
        source_name=safe,
        title=(title or source.stem or safe).strip() or safe,
        note=note or "",
    )


def schedule_knowledge_ingest(
    *,
    entry_id: str,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager=None,
    settings=None,
) -> None:
    """Schedule wiki generation for a newly imported knowledge entry."""
    if session_factory is None or provider_registry is None or agent_registry is None or tool_registry is None:
        raise RuntimeError("Knowledge ingest is not available")
    asyncio.create_task(
        ingest_entry(
            entry_id,
            session_factory=session_factory,
            provider_registry=provider_registry,
            agent_registry=agent_registry,
            tool_registry=tool_registry,
            index_manager=index_manager,
            settings=settings,
        )
    )
