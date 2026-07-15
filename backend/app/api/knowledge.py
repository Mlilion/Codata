"""Knowledge base CRUD — user-registered Feishu document links."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.knowledge.feishu_url import parse_feishu_url
from app.knowledge.ingest import ingest_entry
from app.models.knowledge_entry import KnowledgeEntry

router = APIRouter(prefix="/knowledge")


def _entry_to_dict(e: KnowledgeEntry) -> dict[str, Any]:
    return {
        "id": e.id,
        "title": e.title,
        "feishu_url": e.feishu_url,
        "feishu_token": e.feishu_token,
        "doc_type": e.doc_type,
        "note": e.note,
        "enabled": e.enabled,
        "ingest_status": e.ingest_status,
        "ingest_error": e.ingest_error,
        "created_at": e.time_created.isoformat() if e.time_created else None,
    }


def _schedule_ingest(
    request: Request, background_tasks: BackgroundTasks, entry_id: str
) -> None:
    st = request.app.state
    background_tasks.add_task(
        ingest_entry,
        entry_id,
        session_factory=st.session_factory,
        provider_registry=st.provider_registry,
        agent_registry=st.agent_registry,
        tool_registry=st.tool_registry,
        index_manager=getattr(st, "index_manager", None),
    )


class AddBody(BaseModel):
    feishu_url: str
    note: str | None = None
    title: str | None = None


class PatchBody(BaseModel):
    note: str | None = None
    enabled: bool | None = None
    title: str | None = None


@router.get("")
async def list_knowledge(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    rows = (
        await db.execute(
            select(KnowledgeEntry).order_by(KnowledgeEntry.time_created.desc())
        )
    ).scalars().all()
    return {"entries": [_entry_to_dict(e) for e in rows]}


@router.post("")
async def add_knowledge(
    body: AddBody,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        doc_type, token = parse_feishu_url(body.feishu_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    entry = KnowledgeEntry(
        feishu_url=body.feishu_url.strip(),
        feishu_token=token,
        doc_type=doc_type,
        note=(body.note or "").strip(),
        title=(body.title or "").strip(),
    )
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    _schedule_ingest(request, background_tasks, entry.id)
    return _entry_to_dict(entry)


@router.patch("/{entry_id}")
async def patch_knowledge(
    entry_id: str, body: PatchBody, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    entry = await db.get(KnowledgeEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="知识条目不存在")
    if body.note is not None:
        entry.note = body.note.strip()
    if body.enabled is not None:
        entry.enabled = body.enabled
    if body.title is not None:
        entry.title = body.title.strip()
    await db.flush()
    await db.refresh(entry)
    return _entry_to_dict(entry)


@router.delete("/{entry_id}")
async def delete_knowledge(
    entry_id: str, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    entry = await db.get(KnowledgeEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="知识条目不存在")
    await db.delete(entry)
    await db.flush()
    return {"ok": True}


@router.post("/{entry_id}/reingest")
async def reingest_knowledge(
    entry_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    entry = await db.get(KnowledgeEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="知识条目不存在")
    entry.ingest_status = "pending"
    entry.ingest_error = ""
    await db.flush()
    _schedule_ingest(request, background_tasks, entry.id)
    return _entry_to_dict(entry)
