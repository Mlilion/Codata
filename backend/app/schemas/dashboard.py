"""Dashboard item request/response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class DashboardItemCreate(BaseModel):
    title: str = ""
    # Snapshot payload: {"chartSpec": {...}, "sqlResult": {...}}.
    payload: dict[str, Any]


class DashboardItemUpdate(BaseModel):
    title: str | None = None


class DashboardItemResponse(BaseModel):
    id: str
    title: str
    position: int
    payload: dict[str, Any]
    layout: dict[str, Any] | None = None
    time_created: datetime

    model_config = {"from_attributes": True}


class DashboardReorder(BaseModel):
    ordered_ids: list[str]


class LayoutEntry(BaseModel):
    id: str
    x: int
    y: int
    w: int
    h: int


class DashboardLayoutUpdate(BaseModel):
    layouts: list[LayoutEntry]
