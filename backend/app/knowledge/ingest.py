"""Ingest a knowledge entry: snapshot raw text, then build wiki pages."""
from __future__ import annotations

import logging

from app.knowledge.feishu_reader import find_feishu_client, read_feishu_doc
from app.knowledge import wiki_store
from app.models.knowledge_entry import KnowledgeEntry
from app.models.session import Session
from app.schemas.chat import PromptRequest
from app.session.processor import run_generation
from app.storage.repository import delete_by_id
from app.streaming.manager import GenerationJob
from app.utils.id import generate_ulid

logger = logging.getLogger(__name__)


async def snapshot_raw(entry) -> str:
    client = find_feishu_client()
    if client is None:
        raise RuntimeError("飞书未连接")
    body = await read_feishu_doc(client, entry.doc_type, entry.feishu_token)
    path = wiki_store.raw_dir() / f"{entry.id}.md"
    path.write_text(body, encoding="utf-8")
    return f"raw/{entry.id}.md"


async def ingest_entry(
    entry_id,
    *,
    session_factory,
    provider_registry,
    agent_registry,
    tool_registry,
    index_manager=None,
) -> None:
    """Snapshot the Feishu doc then drive a headless agent to build wiki pages.

    Tracks progress on the KnowledgeEntry row. Runs as a background task, so it
    NEVER lets an exception propagate — failures are recorded as
    ``ingest_status="failed"`` with the error message.
    """
    from app.knowledge.ingest_prompt import build_ingest_prompt

    async with session_factory() as s:
        entry = await s.get(KnowledgeEntry, entry_id)
        if entry is None:
            return
        entry.ingest_status = "processing"
        entry.ingest_error = ""
        await s.commit()

    try:
        raw_rel = await snapshot_raw(entry)
        prompt = build_ingest_prompt(entry, raw_rel, str(wiki_store.wiki_dir()))

        session_id = generate_ulid()
        stream_id = generate_ulid()
        job = GenerationJob(stream_id=stream_id, session_id=session_id)
        req = PromptRequest(
            session_id=session_id,
            text=prompt,
            agent="build",
            workspace=str(wiki_store.wiki_root()),
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

        async with session_factory() as s:
            e = await s.get(KnowledgeEntry, entry_id)
            if e is not None:
                e.ingest_status = "done"
                e.raw_path = raw_rel
                await s.commit()
    except Exception as exc:
        logger.warning("ingest_entry %s failed: %s", entry_id, exc)
        async with session_factory() as s:
            e = await s.get(KnowledgeEntry, entry_id)
            if e is not None:
                e.ingest_status = "failed"
                e.ingest_error = str(exc)
                await s.commit()
