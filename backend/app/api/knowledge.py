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
from app.knowledge.ingest import ingest_entry
from app.knowledge.injection import MAX_INDEX_CHARS
from app.models.knowledge_entry import KnowledgeEntry
from app.tool.extractors import is_supported_binary
from app.utils.id import generate_ulid

router = APIRouter(prefix="/knowledge")

_TEXT_EXTS = {".md", ".markdown", ".txt"}


def _is_supported_upload(name: str) -> bool:
    ext = _Path(name).suffix.lower()
    return ext in _TEXT_EXTS or is_supported_binary(name)


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
    if not _is_supported_upload(name):
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {name}")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe = _Path(name).name
    dest = UPLOAD_DIR / f"{generate_ulid()}_{safe}"
    dest.write_bytes(await file.read())
    factory = request.app.state.session_factory
    async with factory() as s:
        entry = KnowledgeEntry(
            source_type="file",
            file_path=str(dest.resolve()),
            source_name=safe,
            title=safe,
        )
        s.add(entry)
        await s.commit()
        await s.refresh(entry)
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
    target = (base / page).resolve()
    if base != target and base not in target.parents:
        raise HTTPException(status_code=400, detail="非法的 wiki 页面路径")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail=f"wiki 页面不存在: {page}")
    return {"page": page, "content": target.read_text(encoding="utf-8")}


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
    if entry.raw_path:
        try:
            from app.knowledge import wiki_store

            p = wiki_store.wiki_root() / entry.raw_path
            if p.exists():
                p.unlink()
        except Exception:
            pass
    if entry.source_type == "file" and entry.file_path:
        try:
            p = _Path(entry.file_path)
            if p.exists():
                p.unlink()
        except Exception:
            pass
    await db.delete(entry)
    await db.flush()
    return {"ok": True}


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
    _schedule_ingest(request, entry_id=entry_id)
    return result
