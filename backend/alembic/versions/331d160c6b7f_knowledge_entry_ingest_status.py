"""knowledge_entry ingest status

Revision ID: 331d160c6b7f
Revises: 
Create Date: 2026-07-15 17:25:58.664310
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '331d160c6b7f'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("knowledge_entry") as batch:
        batch.add_column(sa.Column("ingest_status", sa.String(), nullable=False, server_default="pending"))
        batch.add_column(sa.Column("ingest_error", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("raw_path", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("wiki_pages", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("knowledge_entry") as batch:
        batch.drop_column("wiki_pages")
        batch.drop_column("raw_path")
        batch.drop_column("ingest_error")
        batch.drop_column("ingest_status")
