"""Dashboard CRUD + pinned-item endpoints.

Multiple named dashboards; one is ``is_default`` and receives pins that don't
name a target. Each DashboardItem belongs to a dashboard (cascade delete).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.dependencies import get_db
from app.models.dashboard import Dashboard
from app.models.dashboard_item import DashboardItem
from app.schemas.dashboard import (
    DashboardCreate,
    DashboardItemCreate,
    DashboardItemResponse,
    DashboardItemUpdate,
    DashboardLayoutUpdate,
    DashboardReorder,
    DashboardResponse,
    DashboardUpdate,
)
from app.utils.id import generate_ulid

logger = logging.getLogger(__name__)

router = APIRouter()


async def _default_dashboard_id(db: AsyncSession) -> str:
    """Return the default dashboard's id, creating one if none exists."""
    board = (
        await db.execute(select(Dashboard).where(Dashboard.is_default.is_(True)))
    ).scalar_one_or_none()
    if board is None:
        board = (
            await db.execute(select(Dashboard).order_by(Dashboard.position.asc()))
        ).scalars().first()
    if board is None:
        board = Dashboard(id=generate_ulid(), name="我的看板", is_default=True, position=0)
        db.add(board)
        await db.flush()
    return board.id


async def _item_counts(db: AsyncSession) -> dict[str, int]:
    rows = await db.execute(
        select(DashboardItem.dashboard_id, func.count(DashboardItem.id)).group_by(
            DashboardItem.dashboard_id
        )
    )
    return {str(dash_id): count for dash_id, count in rows.all() if dash_id is not None}


class RefreshError(Exception):
    """Refresh could not complete; carries a user-facing reason."""


def _get_mcp_manager(request: Request):
    """Resolve the MCP manager off app.state (connector_registry first)."""
    registry = getattr(request.app.state, "connector_registry", None)
    if registry is not None and getattr(registry, "mcp_manager", None):
        return registry.mcp_manager
    return getattr(request.app.state, "mcp_manager", None)


def _find_execute_sql_client(manager):
    """Find a connected MCP client exposing an ``execute_sql`` tool (datasage).

    Server name is not fixed, so we match by tool name — same principle as the
    datasage result parser's suffix matching.
    """
    if manager is None:
        return None
    for client in getattr(manager, "_clients", {}).values():
        if getattr(client, "status", None) != "connected":
            continue
        try:
            tool_names = {t.name for t in client.list_tools()}
        except Exception:
            continue
        if "execute_sql" in tool_names:
            return client
    return None


async def _rerun_sql(request: Request, sql: str) -> dict:
    """Re-run a stored SQL via datasage execute_sql; return fresh sql_result.

    Raises RefreshError with a user-facing message on any failure (no data
    source, async job, SQL error, non-tabular result).
    """
    from app.mcp.datasage_parser import _parse_execute_sql

    manager = _get_mcp_manager(request)
    client = _find_execute_sql_client(manager)
    if client is None:
        raise RefreshError("数据源未连接,无法刷新")

    try:
        result = await client.call_tool("execute_sql", {"sql": sql})
    except Exception as e:  # noqa: BLE001
        raise RefreshError(f"查询执行失败: {e}") from e

    # Extract text content (mirrors McpToolWrapper).
    text_parts = [item.text for item in result.content if getattr(item, "type", None) == "text"]
    output = "\n".join(text_parts)
    if getattr(result, "isError", False):
        raise RefreshError(output or "查询返回错误")

    try:
        payload = json.loads(output.strip()) if output.strip() else None
    except (json.JSONDecodeError, ValueError):
        payload = None
    parsed = _parse_execute_sql({"sql": sql}, payload) if isinstance(payload, dict) else None

    if not parsed or parsed.get("codata_kind") != "sql_result":
        # async job / non-tabular / unparseable
        raise RefreshError("结果无法刷新(可能过大需异步查询,或结构已变化)")
    return parsed


# ------------------------------------------------------------------
# Dashboards
# ------------------------------------------------------------------


@router.get("/dashboards", response_model=list[DashboardResponse])
async def list_dashboards(db: AsyncSession = Depends(get_db)) -> list[DashboardResponse]:
    """List all dashboards (creating the default if none exist), with item counts."""
    await _default_dashboard_id(db)
    boards = (
        await db.execute(
            select(Dashboard).order_by(Dashboard.position.asc(), Dashboard.time_created.asc())
        )
    ).scalars().all()
    counts = await _item_counts(db)
    out = []
    for b in boards:
        resp = DashboardResponse.model_validate(b)
        resp.item_count = counts.get(b.id, 0)
        out.append(resp)
    return out


@router.post("/dashboards", response_model=DashboardResponse)
async def create_dashboard(
    body: DashboardCreate,
    db: AsyncSession = Depends(get_db),
) -> DashboardResponse:
    """Create a new (non-default) dashboard, placed at the end."""
    max_pos = (await db.execute(select(func.max(Dashboard.position)))).scalar()
    # Ensure at least a default exists so the new board isn't accidentally the only one.
    await _default_dashboard_id(db)
    board = Dashboard(
        id=generate_ulid(),
        name=body.name.strip() or "未命名看板",
        is_default=False,
        position=(max_pos or 0) + 1,
    )
    db.add(board)
    await db.flush()
    await db.refresh(board)
    return DashboardResponse.model_validate(board)


@router.patch("/dashboards/{dashboard_id}", response_model=DashboardResponse)
async def update_dashboard(
    dashboard_id: str,
    body: DashboardUpdate,
    db: AsyncSession = Depends(get_db),
) -> DashboardResponse:
    """Rename a dashboard."""
    board = (
        await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    ).scalar_one_or_none()
    if board is None:
        raise HTTPException(404, "Dashboard not found")
    if body.name is not None:
        board.name = body.name.strip() or board.name
    await db.flush()
    await db.refresh(board)
    return DashboardResponse.model_validate(board)


@router.delete("/dashboards/{dashboard_id}")
async def delete_dashboard(
    dashboard_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete a dashboard and its items. Refuses to delete the last one."""
    board = (
        await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    ).scalar_one_or_none()
    if board is None:
        return {"success": True}

    total = (await db.execute(select(func.count(Dashboard.id)))).scalar() or 0
    if total <= 1:
        raise HTTPException(400, "无法删除最后一个看板")

    was_default = board.is_default
    # Cascade delete items (ondelete=CASCADE covers DBs that enforce FKs; delete
    # explicitly too since SQLite may not have FK enforcement on).
    items = (
        await db.execute(select(DashboardItem).where(DashboardItem.dashboard_id == dashboard_id))
    ).scalars().all()
    for item in items:
        await db.delete(item)
    await db.delete(board)
    await db.flush()

    # If we removed the default, promote another board.
    if was_default:
        nxt = (
            await db.execute(select(Dashboard).order_by(Dashboard.position.asc()))
        ).scalars().first()
        if nxt is not None:
            nxt.is_default = True
    return {"success": True}


# ------------------------------------------------------------------
# Items
# ------------------------------------------------------------------


@router.get("/dashboard/items", response_model=list[DashboardItemResponse])
async def list_dashboard_items(
    dashboard_id: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[DashboardItemResponse]:
    """List pinned items, optionally scoped to a dashboard, in display order."""
    stmt = select(DashboardItem)
    if dashboard_id is not None:
        stmt = stmt.where(DashboardItem.dashboard_id == dashboard_id)
    stmt = stmt.order_by(DashboardItem.position.asc(), DashboardItem.time_created.asc())
    result = await db.execute(stmt)
    return [DashboardItemResponse.model_validate(item) for item in result.scalars().all()]


@router.post("/dashboard/items", response_model=DashboardItemResponse)
async def create_dashboard_item(
    body: DashboardItemCreate,
    db: AsyncSession = Depends(get_db),
) -> DashboardItemResponse:
    """Pin a chart. Falls to the default dashboard when none is named."""
    target = body.dashboard_id or await _default_dashboard_id(db)
    max_pos = (
        await db.execute(
            select(func.max(DashboardItem.position)).where(
                DashboardItem.dashboard_id == target
            )
        )
    ).scalar()
    item = DashboardItem(
        id=generate_ulid(),
        dashboard_id=target,
        title=body.title,
        position=(max_pos or 0) + 1,
        payload=body.payload,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return DashboardItemResponse.model_validate(item)


@router.patch("/dashboard/items/{item_id}", response_model=DashboardItemResponse)
async def update_dashboard_item(
    item_id: str,
    body: DashboardItemUpdate,
    db: AsyncSession = Depends(get_db),
) -> DashboardItemResponse:
    """Rename a dashboard item."""
    item = (
        await db.execute(select(DashboardItem).where(DashboardItem.id == item_id))
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, "Dashboard item not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(item, field, value)

    await db.flush()
    await db.refresh(item)
    return DashboardItemResponse.model_validate(item)


@router.post("/dashboard/reorder")
async def reorder_dashboard_items(
    body: DashboardReorder,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Set item order from a list of ids (index → position)."""
    result = await db.execute(select(DashboardItem))
    by_id = {item.id: item for item in result.scalars().all()}
    for index, item_id in enumerate(body.ordered_ids):
        item = by_id.get(item_id)
        if item is not None:
            item.position = index
    await db.flush()
    return {"success": True}


@router.post("/dashboard/items/{item_id}/refresh", response_model=DashboardItemResponse)
async def refresh_dashboard_item(
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> DashboardItemResponse:
    """Re-run the item's stored SQL and update its snapshot with fresh data.

    On any failure the existing snapshot is left untouched (a 400/502 is
    returned with a user-facing reason).
    """
    item = (
        await db.execute(select(DashboardItem).where(DashboardItem.id == item_id))
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, "Dashboard item not found")

    payload = dict(item.payload or {})
    sql_result = dict(payload.get("sqlResult") or {})
    sql = sql_result.get("sql")
    if not isinstance(sql, str) or not sql.strip():
        raise HTTPException(400, "该图表没有可重跑的 SQL")

    try:
        fresh = await _rerun_sql(request, sql)
    except RefreshError as e:
        raise HTTPException(502, str(e)) from e

    # Update only the data; keep sql + chartSpec as pinned.
    sql_result["columns"] = fresh["columns"]
    sql_result["rows"] = fresh["rows"]
    sql_result["rowCount"] = fresh.get("row_count", len(fresh["rows"]))
    sql_result["truncated"] = fresh.get("truncated", False)
    payload["sqlResult"] = sql_result
    item.payload = payload
    flag_modified(item, "payload")  # JSON column: force update on in-place change
    item.refreshed_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(item)
    return DashboardItemResponse.model_validate(item)


@router.post("/dashboard/layout")
async def update_dashboard_layout(
    body: DashboardLayoutUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Persist grid-canvas positions/sizes for a batch of items."""
    result = await db.execute(select(DashboardItem))
    by_id = {item.id: item for item in result.scalars().all()}
    for entry in body.layouts:
        item = by_id.get(entry.id)
        if item is not None:
            item.layout = {"x": entry.x, "y": entry.y, "w": entry.w, "h": entry.h}
    await db.flush()
    return {"success": True}


@router.delete("/dashboard/items/{item_id}")
async def delete_dashboard_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete a dashboard item. Idempotent."""
    item = (
        await db.execute(select(DashboardItem).where(DashboardItem.id == item_id))
    ).scalar_one_or_none()
    if item is None:
        return {"success": True}
    await db.delete(item)
    return {"success": True}
