"""DashboardItem model — a chart pinned to the Codata dashboard.

Each item is a snapshot: it stores the chart spec plus the tabular result data
(columns + rows) captured when the user pinned it, so the dashboard renders
without re-running the query. Single default dashboard for now (no dashboard
entity) — every pinned chart is an item ordered by ``position``.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Integer, String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.utils.id import generate_ulid


class DashboardItem(Base, TimestampMixin):
    __tablename__ = "dashboard_item"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_ulid)
    title: Mapped[str] = mapped_column(String, nullable=False, default="")
    # Ordering within the dashboard (ascending). New items get max+1.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    # Snapshot payload: {"chartSpec": {...}, "sqlResult": {...}} mirroring the
    # frontend Artifact's chartSpec + sqlResult shapes.
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
