"""Dashboard item CRUD endpoints.

A single default dashboard (no dashboard entity yet); every pinned chart is a
DashboardItem ordered by ``position``.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.dashboard_item import DashboardItem
from app.schemas.dashboard import (
    DashboardItemCreate,
    DashboardItemResponse,
    DashboardItemUpdate,
    DashboardLayoutUpdate,
    DashboardReorder,
)
from app.utils.id import generate_ulid

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/dashboard/items", response_model=list[DashboardItemResponse])
async def list_dashboard_items(
    db: AsyncSession = Depends(get_db),
) -> list[DashboardItemResponse]:
    """List all pinned dashboard items, in display order."""
    result = await db.execute(
        select(DashboardItem).order_by(
            DashboardItem.position.asc(), DashboardItem.time_created.asc()
        )
    )
    return [DashboardItemResponse.model_validate(item) for item in result.scalars().all()]


@router.post("/dashboard/items", response_model=DashboardItemResponse)
async def create_dashboard_item(
    body: DashboardItemCreate,
    db: AsyncSession = Depends(get_db),
) -> DashboardItemResponse:
    """Pin a chart to the dashboard. New item is placed at the end."""
    max_pos = (
        await db.execute(select(func.max(DashboardItem.position)))
    ).scalar()
    item = DashboardItem(
        id=generate_ulid(),
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
