"""Knowledge base CRUD — user-registered Feishu document links."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path as _Path
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    UploadFile,
)
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.files import UPLOAD_DIR
from app.dependencies import get_db
from app.knowledge import wiki_store
from app.knowledge.feishu_url import parse_feishu_url
from app.knowledge.source_import import (
    import_local_file,
    is_supported_knowledge_source,
    register_file_entry,
)
from app.knowledge.ingest import cleanup_entry, ingest_entry, reingest_entry
from app.knowledge.injection import MAX_INDEX_CHARS
from app.models.knowledge_entry import KnowledgeEntry
from app.utils.id import generate_ulid

router = APIRouter(prefix="/knowledge")


def _parse_wiki_pages(raw: str) -> list[str]:
    try:
        v = json.loads(raw or "[]")
        return v if isinstance(v, list) else []
    except Exception:
        return []


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
        "source_type": e.source_type,
        "source_name": e.source_name,
        "file_path": e.file_path,
        "wiki_pages": _parse_wiki_pages(e.wiki_pages),
        "created_at": e.time_created.isoformat() if e.time_created else None,
    }


def _schedule_ingest(request: Request, entry_id: str) -> None:
    st = request.app.state
    asyncio.create_task(
        ingest_entry(
            entry_id,
            session_factory=st.session_factory,
            provider_registry=st.provider_registry,
            agent_registry=st.agent_registry,
            tool_registry=st.tool_registry,
            index_manager=getattr(st, "index_manager", None),
            settings=getattr(st, "settings", None),
        )
    )


def _schedule_reingest(request: Request, entry_id: str) -> None:
    st = request.app.state
    asyncio.create_task(
        reingest_entry(
            entry_id,
            session_factory=st.session_factory,
            provider_registry=st.provider_registry,
            agent_registry=st.agent_registry,
            tool_registry=st.tool_registry,
            index_manager=getattr(st, "index_manager", None),
            settings=getattr(st, "settings", None),
        )
    )


def _schedule_cleanup(request: Request, entry_id: str) -> None:
    st = request.app.state
    asyncio.create_task(
        cleanup_entry(
            entry_id,
            session_factory=st.session_factory,
            provider_registry=st.provider_registry,
            agent_registry=st.agent_registry,
            tool_registry=st.tool_registry,
            index_manager=getattr(st, "index_manager", None),
            settings=getattr(st, "settings", None),
        )
    )


class AddBody(BaseModel):
    feishu_url: str
    note: str | None = None
    title: str | None = None


class PatchBody(BaseModel):
    note: str | None = None
    enabled: bool | None = None
    title: str | None = None


class ImportBody(BaseModel):
    file_path: str
    workspace: str | None = None
    note: str | None = None
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
) -> dict[str, Any]:
    try:
        doc_type, token = parse_feishu_url(body.feishu_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    factory = request.app.state.session_factory
    async with factory() as s:
        entry = KnowledgeEntry(
            feishu_url=body.feishu_url.strip(),
            feishu_token=token,
            doc_type=doc_type,
            note=(body.note or "").strip(),
            title=(body.title or "").strip(),
        )
        s.add(entry)
        await s.commit()
        await s.refresh(entry)
        result = _entry_to_dict(entry)
    _schedule_ingest(request, entry_id=result["id"])
    return result


@router.post("/upload")
async def upload_knowledge(
    file: UploadFile,
    request: Request,
) -> dict[str, Any]:
    name = file.filename or "untitled"
    if not is_supported_knowledge_source(name):
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {name}")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe = _Path(name).name
    dest = UPLOAD_DIR / f"{generate_ulid()}_{safe}"
    dest.write_bytes(await file.read())
    entry = await register_file_entry(
        request.app.state.session_factory,
        stored_path=dest,
        source_name=safe,
        title=safe,
    )
    result = _entry_to_dict(entry)
    _schedule_ingest(request, entry_id=result["id"])
    return result


@router.post("/import")
async def import_knowledge(
    body: ImportBody,
    request: Request,
) -> dict[str, Any]:
    try:
        entry = await import_local_file(
            request.app.state.session_factory,
            file_path=body.file_path,
            workspace=body.workspace,
            title=body.title,
            note=body.note,
        )
    except (FileNotFoundError, IsADirectoryError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    result = _entry_to_dict(entry)
    _schedule_ingest(request, entry_id=result["id"])
    return result


@router.get("/capacity")
async def knowledge_capacity(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    idx = wiki_store.index_path()
    index_chars = len(idx.read_text(encoding="utf-8")) if idx.exists() else 0
    done = (
        await db.execute(
            select(KnowledgeEntry).where(KnowledgeEntry.ingest_status == "done")
        )
    ).scalars().all()
    entries_done = len(done)
    return {
        "index_chars": index_chars,
        "max_chars": MAX_INDEX_CHARS,
        "approx_docs": entries_done,
        "entries_done": entries_done,
    }


@router.get("/wiki")
async def read_wiki_page(page: str) -> dict[str, Any]:
    from app.knowledge import wiki_store
    base = wiki_store.wiki_dir().resolve()
    candidates = [page] if page.endswith(".md") else [page, f"{page}.md"]
    for name in candidates:
        target = (base / name).resolve()
        if base != target and base not in target.parents:
            raise HTTPException(status_code=400, detail="非法的 wiki 页面路径")
        if target.exists() and target.is_file():
            return {"page": name, "content": target.read_text(encoding="utf-8")}
    raise HTTPException(status_code=404, detail=f"wiki 页面不存在: {page}")


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
    entry_id: str, request: Request, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    entry = await db.get(KnowledgeEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="知识条目不存在")
    # Idempotent: if cleanup is already running, don't reschedule.
    if entry.ingest_status == "deleting":
        return _entry_to_dict(entry)
    # Uploaded files are deterministic to remove now; wiki pages + row are
    # cleaned up asynchronously by the background agent.
    if entry.source_type == "file" and entry.file_path:
        try:
            p = _Path(entry.file_path)
            if p.exists():
                p.unlink()
        except Exception:
            pass
    entry.ingest_status = "deleting"
    entry.ingest_error = ""
    await db.flush()
    await db.refresh(entry)
    _schedule_cleanup(request, entry_id=entry_id)
    return _entry_to_dict(entry)


@router.post("/{entry_id}/reingest")
async def reingest_knowledge(
    entry_id: str,
    request: Request,
) -> dict[str, Any]:
    factory = request.app.state.session_factory
    async with factory() as s:
        entry = await s.get(KnowledgeEntry, entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="知识条目不存在")
        entry.ingest_status = "pending"
        entry.ingest_error = ""
        await s.commit()
        await s.refresh(entry)
        result = _entry_to_dict(entry)
    _schedule_reingest(request, entry_id=entry_id)
    return result
