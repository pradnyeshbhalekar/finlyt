"""ask history: Ask Finlyt chats, kept for ASK_KEEP_DAYS

Revision ID: c4f8a2e6d913
Revises: b7e2d4c9a1f3
Create Date: 2026-11-06 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4f8a2e6d913"
down_revision: Union[str, Sequence[str], None] = "b7e2d4c9a1f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ask_threads",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_ask_threads_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ask_threads")),
    )
    op.create_index("ix_ask_threads_user_updated", "ask_threads", ["user_id", "updated_at"], unique=False)
    op.create_table(
        "ask_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("thread_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=8), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column("tools_used", postgresql.ARRAY(sa.String(length=64)), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("role IN ('user', 'finlyt')", name=op.f("ck_ask_messages_role")),
        sa.ForeignKeyConstraint(["thread_id"], ["ask_threads.id"], name=op.f("fk_ask_messages_thread_id_ask_threads"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ask_messages")),
    )
    op.create_index(op.f("ix_ask_messages_thread_id"), "ask_messages", ["thread_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ask_messages_thread_id"), table_name="ask_messages")
    op.drop_table("ask_messages")
    op.drop_index("ix_ask_threads_user_updated", table_name="ask_threads")
    op.drop_table("ask_threads")
