"""AnalysisMemory model — structured, user-scoped data-analysis memory.

Accumulates what the user analyses over time (frequent metrics, dimensions,
caliber preferences, analysis topics) so the data agent can "remember" them and
suggest deeper analyses. Open-source build is single-user, so ``user_id`` stays
null and there is one global row; the column is reserved for a future
multi-user upgrade.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.utils.id import generate_ulid


class AnalysisMemory(Base, TimestampMixin):
    __tablename__ = "analysis_memory"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_ulid)
    # Reserved for multi-user; null = the single open-source user (one global row).
    user_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # Structured memory:
    #   {
    #     "frequent_metrics":    [{"name","table","count","last_used"}],
    #     "frequent_dimensions": [{"field","count"}],
    #     "caliber_preferences": ["按周聚合", ...],
    #     "analysis_topics":     [{"summary","at"}],
    #   }
    data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
