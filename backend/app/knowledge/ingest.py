"""Ingest a knowledge entry: snapshot raw text, then build wiki pages."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from app.knowledge.cleanup_prompt import build_cleanup_prompt
from app.knowledge.ingest_prompt import build_ingest_prompt
from app.knowledge.feishu_reader import read_feishu_doc
from app.knowledge import wiki_store
from app.tool.extractors import extract_document, is_supported_binary
from app.models.knowledge_entry import KnowledgeEntry
from app.models.session import Session
from app.provider.resolve import resolve_default_model
from app.schemas.chat import PromptRequest
from app.session.processor import run_generation
from app.storage.repository import delete_by_id
from app.streaming.manager import GenerationJob
from app.utils.id import generate_ulid

logger = logging.getLogger(__name__)

# Serializes wiki writes across ingest/cleanup/reingest background tasks.
# Single-user local-first: concurrent agents editing the same index.md would
# overwrite each other (later write wins), so only one may hold the wiki at a time.
_WIKI_AGENT_LOCK = asyncio.Lock()


def _snapshot_wiki_files() -> set[tuple[str, int]]:
    """(name, mtime_ns) per wiki page, so the before/after diff catches both
    newly-created AND edited pages — important for reingest, where the agent
    edits existing pages rather than creating new ones."""
    d = wiki_store.wiki_dir()
    try:
        return {(p.name, p.stat().st_mtime_ns) for p in d.glob("*.md")}
    except Exception:
        return set()


async def _set_status(session_factory, entry_id, status) -> None:
    try:
        async with session_factory() as s:
            e = await s.get(KnowledgeEntry, entry_id)
            if e is not None:
                e.ingest_status = status
                await s.commit()
    except Exception:
        logger.debug("stage update to %s failed for %s", status, entry_id, exc_info=True)


async def snapshot_raw(entry) -> str:
    if getattr(entry, "source_type", "feishu") == "file":
        body = _extract_file(entry.file_path)
    else:
        body = await read_feishu_doc(None, entry.doc_type, entry.feishu_token)
    path = wiki_store.raw_dir() / f"{entry.id}.md"
    path.write_text(body, encoding="utf-8")
    return f"raw/{entry.id}.md"


def _extract_file(file_path: str) -> str:
    p = Path(file_path)
    if not p.is_absolute():
        p = (wiki_store.wiki_root().parent / file_path).resolve()
    if not p.exists():
        raise RuntimeError(f"文件不存在: {file_path}")
    if is_supported_binary(str(p)):
        return extract_document(str(p))
    return p.read_text(encoding="utf-8", errors="replace")


async def ingest_entry(
    entry_id,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager=None,
    settings=None,
) -> None:
    """Snapshot the Feishu doc then drive a headless agent to build wiki pages.

    Tracks progress on the KnowledgeEntry row. Runs as a background task, so it
    NEVER lets an exception propagate — failures are recorded as
    ``ingest_status="failed"`` with the error message.
    """
    from app.knowledge.ingest_prompt import build_ingest_prompt

    # The creating request commits the new row only AFTER its response is sent
    # (get_db wraps the request in a single transaction), and BackgroundTasks
    # run after the response too — so this fresh session may not see the row on
    # the first try. Retry with a short backoff; the commit lands within ms.
    entry = None
    for attempt in range(10):
        async with session_factory() as s:
            entry = await s.get(KnowledgeEntry, entry_id)
            if entry is not None:
                entry.ingest_status = "processing"
                entry.ingest_error = ""
                await s.commit()
                break
        await asyncio.sleep(0.2)
    if entry is None:
        logger.warning(
            "ingest_entry %s: entry not found after retries; skipping", entry_id
        )
        return

    try:
        await _set_status(session_factory, entry_id, "extracting")
        raw_rel = await snapshot_raw(entry)

        async with _WIKI_AGENT_LOCK:
            before = _snapshot_wiki_files()
            prompt = build_ingest_prompt(entry, raw_rel, str(wiki_store.wiki_dir()))
            await _set_status(session_factory, entry_id, "building")

            session_id = generate_ulid()
            stream_id = generate_ulid()
            job = GenerationJob(stream_id=stream_id, session_id=session_id)
            model_id, provider_id = (
                resolve_default_model(provider_registry, settings) if settings else (None, None)
            )
            req = PromptRequest(
                session_id=session_id,
                text=prompt,
                agent="build",
                workspace=str(wiki_store.wiki_root()),
                model=model_id,
                provider_id=provider_id,
            )
            await run_generation(
                job,
                req,
                session_factory=session_factory,
                provider_registry=provider_registry,
                agent_registry=agent_registry,
                tool_registry=tool_registry,
                index_manager=index_manager,
            )

            await _set_status(session_factory, entry_id, "indexing")

            # The headless ingest session was only a vehicle for the file edits;
            # delete it so it never surfaces as a phantom chat in the user's history.
            try:
                async with session_factory() as s:
                    await delete_by_id(s, Session, session_id)
                    await s.commit()
            except Exception as cleanup_exc:  # best-effort: never fail a good ingest
                logger.warning(
                    "ingest_entry %s: failed to delete throwaway session %s: %s",
                    entry_id,
                    session_id,
                    cleanup_exc,
                )

            after = _snapshot_wiki_files()
            # Pages whose (name, mtime) changed = created or edited by this ingest.
            changed = after - before
            new_pages = sorted({name for name, _mtime in changed})

            async with session_factory() as s:
                e = await s.get(KnowledgeEntry, entry_id)
                if e is not None:
                    e.ingest_status = "done"
                    e.raw_path = raw_rel
                    e.wiki_pages = json.dumps(new_pages, ensure_ascii=False)
                    await s.commit()
    except Exception as exc:
        logger.warning("ingest_entry %s failed: %s", entry_id, exc)
        async with session_factory() as s:
            e = await s.get(KnowledgeEntry, entry_id)
            if e is not None:
                e.ingest_status = "failed"
                e.ingest_error = str(exc)
                await s.commit()


def _source_page_of(entry) -> str | None:
    """The entry's own source-*.md page, parsed from wiki_pages JSON."""
    try:
        pages = json.loads(entry.wiki_pages or "[]")
    except Exception:
        pages = []
    for name in pages:
        if isinstance(name, str) and name.startswith("source-"):
            return name
    return None


async def _run_wiki_agent(
    prompt: str,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager,
    model_id=None,
    provider_id=None,
) -> None:
    """Drive a headless build agent over the wiki dir, then delete the
    throwaway session so it never surfaces as a phantom chat."""
    session_id = generate_ulid()
    stream_id = generate_ulid()
    job = GenerationJob(stream_id=stream_id, session_id=session_id)
    req = PromptRequest(
        session_id=session_id,
        text=prompt,
        agent="build",
        workspace=str(wiki_store.wiki_root()),
        model=model_id,
        provider_id=provider_id,
    )
    await run_generation(
        job,
        req,
        session_factory=session_factory,
        provider_registry=provider_registry,
        agent_registry=agent_registry,
        tool_registry=tool_registry,
        index_manager=index_manager,
    )
    try:
        async with session_factory() as s:
            await delete_by_id(s, Session, session_id)
            await s.commit()
    except Exception as cleanup_exc:  # best-effort: never fail a good run
        logger.warning(
            "failed to delete throwaway session %s: %s", session_id, cleanup_exc
        )


async def cleanup_entry(
    entry_id,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager=None,
    settings=None,
) -> None:
    """Remove an entry's wiki footprint via a headless agent, then delete the
    DB row and raw snapshot. Runs as a background task; NEVER raises — failures
    are recorded as ``ingest_status="failed"`` so the user can retry the delete.
    """
    try:
        async with session_factory() as s:
            entry = await s.get(KnowledgeEntry, entry_id)
            if entry is None:
                return
            raw_path = entry.raw_path
            source_page = _source_page_of(entry)

        async with _WIKI_AGENT_LOCK:
            model_id, provider_id = (
                resolve_default_model(provider_registry, settings) if settings else (None, None)
            )
            if source_page is not None:
                prompt = build_cleanup_prompt(entry, source_page, str(wiki_store.wiki_dir()))
                await _run_wiki_agent(
                    prompt,
                    session_factory=session_factory,
                    provider_registry=provider_registry,
                    agent_registry=agent_registry,
                    tool_registry=tool_registry,
                    index_manager=index_manager,
                    model_id=model_id,
                    provider_id=provider_id,
                )

            # Delete raw snapshot (best-effort) then the DB row.
            if raw_path:
                try:
                    p = wiki_store.wiki_root() / raw_path
                    if p.exists():
                        p.unlink()
                except Exception:
                    logger.debug("cleanup: raw unlink failed for %s", entry_id, exc_info=True)
            async with session_factory() as s:
                e = await s.get(KnowledgeEntry, entry_id)
                if e is not None:
                    await s.delete(e)
                    await s.commit()
    except Exception as exc:
        logger.warning("cleanup_entry %s failed: %s", entry_id, exc)
        async with session_factory() as s:
            e = await s.get(KnowledgeEntry, entry_id)
            if e is not None:
                e.ingest_status = "failed"
                e.ingest_error = str(exc)
                await s.commit()


async def reingest_entry(
    entry_id,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager=None,
    settings=None,
) -> None:
    """Reload an entry: remove its stale wiki pages, then re-snapshot the
    source and rebuild. Unlike delete, the DB row and (re-fetched) raw
    snapshot are preserved. Never raises; failures set ingest_status=failed.
    """
    try:
        async with session_factory() as s:
            entry = await s.get(KnowledgeEntry, entry_id)
            if entry is None:
                return
            source_page = _source_page_of(entry)

        async with _WIKI_AGENT_LOCK:
            model_id, provider_id = (
                resolve_default_model(provider_registry, settings) if settings else (None, None)
            )
            # 1. Clean stale wiki pages (skip if never ingested).
            if source_page is not None:
                cleanup_prompt = build_cleanup_prompt(
                    entry, source_page, str(wiki_store.wiki_dir())
                )
                await _run_wiki_agent(
                    cleanup_prompt,
                    session_factory=session_factory,
                    provider_registry=provider_registry,
                    agent_registry=agent_registry,
                    tool_registry=tool_registry,
                    index_manager=index_manager,
                    model_id=model_id,
                    provider_id=provider_id,
                )
            # 2. Re-snapshot source and rebuild.
            await _set_status(session_factory, entry_id, "extracting")
            raw_rel = await snapshot_raw(entry)
            before = _snapshot_wiki_files()
            ingest_prompt = build_ingest_prompt(entry, raw_rel, str(wiki_store.wiki_dir()))
            await _set_status(session_factory, entry_id, "building")
            await _run_wiki_agent(
                ingest_prompt,
                session_factory=session_factory,
                provider_registry=provider_registry,
                agent_registry=agent_registry,
                tool_registry=tool_registry,
                index_manager=index_manager,
                model_id=model_id,
                provider_id=provider_id,
            )
            after = _snapshot_wiki_files()
            new_pages = sorted({name for name, _mtime in (after - before)})
            async with session_factory() as s:
                e = await s.get(KnowledgeEntry, entry_id)
                if e is not None:
                    e.ingest_status = "done"
                    e.raw_path = raw_rel
                    e.wiki_pages = json.dumps(new_pages, ensure_ascii=False)
                    await s.commit()
    except Exception as exc:
        logger.warning("reingest_entry %s failed: %s", entry_id, exc)
        async with session_factory() as s:
            e = await s.get(KnowledgeEntry, entry_id)
            if e is not None:
                e.ingest_status = "failed"
                e.ingest_error = str(exc)
                await s.commit()
