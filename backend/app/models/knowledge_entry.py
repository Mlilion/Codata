"""KnowledgeEntry model — a user-registered Feishu document link.

Users paste Feishu doc links into the knowledge base; the data agent sees a
list of them each turn and can read a doc's body on demand via the Feishu MCP.
Open-source build is single-user, so ``user_id`` stays null; ``user_id`` and
``scope`` are reserved for a future multi-user (team-shared) upgrade.
"""

from __future__ import annotations

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.utils.id import generate_ulid


class KnowledgeEntry(Base, TimestampMixin):
    __tablename__ = "knowledge_entry"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=generate_ulid)
    # Reserved for multi-user; null = the single open-source user.
    user_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # Reserved for personal/team visibility; default personal.
    scope: Mapped[str] = mapped_column(String, nullable=False, default="personal")
    title: Mapped[str] = mapped_column(String, nullable=False, default="")
    feishu_url: Mapped[str] = mapped_column(Text, nullable=False)
    feishu_token: Mapped[str] = mapped_column(String, nullable=False)
    doc_type: Mapped[str] = mapped_column(String, nullable=False)  # docx/wiki/sheet/bitable
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
