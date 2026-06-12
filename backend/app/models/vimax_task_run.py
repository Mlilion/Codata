"""ViMaxTaskRun model — persistent mapping for long-running video tasks."""

from __future__ import annotations

from typing import Any, TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.utils.id import generate_ulid

if TYPE_CHECKING:
    from app.models.session import Session


class ViMaxTaskRun(Base, TimestampMixin):
    __tablename__ = "vimax_task_run"
    __table_args__ = (
        Index("ix_vimax_task_run_session_id", "session_id"),
        Index("ix_vimax_task_run_session_status", "session_id", "status"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_ulid)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("session.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[str] = mapped_column(String, nullable=False)
    call_id: Mapped[str] = mapped_column(String, nullable=False)
    task_id: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    tool_id: Mapped[str] = mapped_column(String, nullable=False, default="vimax_generate_video")
    mode: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    stage: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    working_dir: Mapped[str] = mapped_column(String, nullable=False, default="")
    final_video_path: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    runtime_status: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    session: Mapped[Session] = relationship()
