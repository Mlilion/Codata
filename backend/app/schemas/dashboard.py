"""Dashboard item request/response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


# --- Dashboard (named collection) ---


class DashboardCreate(BaseModel):
    name: str


class DashboardUpdate(BaseModel):
    name: str | None = None


class DashboardResponse(BaseModel):
    id: str
    name: str
    is_default: bool
    position: int
    item_count: int = 0
    time_created: datetime

    model_config = {"from_attributes": True}


# --- Dashboard items (pinned charts) ---


class DashboardItemCreate(BaseModel):
    title: str = ""
    # Snapshot payload: {"chartSpec": {...}, "sqlResult": {...}}.
    payload: dict[str, Any]
    # Target dashboard; null → the default dashboard.
    dashboard_id: str | None = None


class DashboardItemUpdate(BaseModel):
    title: str | None = None


class DashboardItemResponse(BaseModel):
    id: str
    dashboard_id: str | None = None
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
