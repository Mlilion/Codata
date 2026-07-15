"""knowledge_entry source_type

Revision ID: 48197d074a69
Revises: 331d160c6b7f
Create Date: 2026-07-15 20:34:59.961902
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '48197d074a69'
down_revision: Union[str, None] = '331d160c6b7f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("knowledge_entry") as batch:
        batch.add_column(sa.Column("source_type", sa.String(), nullable=False, server_default="feishu"))
        batch.add_column(sa.Column("file_path", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("source_name", sa.Text(), nullable=False, server_default=""))
    with op.batch_alter_table("knowledge_entry") as batch:
        batch.alter_column("feishu_url", existing_type=sa.Text(), nullable=True)
        batch.alter_column("feishu_token", existing_type=sa.String(), nullable=True)
        batch.alter_column("doc_type", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("knowledge_entry") as batch:
        batch.alter_column("doc_type", existing_type=sa.String(), nullable=False)
        batch.alter_column("feishu_token", existing_type=sa.String(), nullable=False)
        batch.alter_column("feishu_url", existing_type=sa.Text(), nullable=False)
    with op.batch_alter_table("knowledge_entry") as batch:
        batch.drop_column("source_name")
        batch.drop_column("file_path")
        batch.drop_column("source_type")
