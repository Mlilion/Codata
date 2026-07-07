"""Dashboard model — a named collection of pinned chart items.

A dashboard groups DashboardItems (pinned charts). One dashboard is marked
``is_default`` and receives pins that don't name a target. Items reference a
dashboard via ``DashboardItem.dashboard_id`` (cascade delete).
"""

from __future__ import annotations

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.utils.id import generate_ulid


class Dashboard(Base, TimestampMixin):
    __tablename__ = "dashboard"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_ulid)
    name: Mapped[str] = mapped_column(String, nullable=False, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
