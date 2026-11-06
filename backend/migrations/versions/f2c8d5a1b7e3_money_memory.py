"""money memory and richer Ask answers: income, monthly commitments, notes; extras on messages

Revision ID: f2c8d5a1b7e3
Revises: e4a7c2b9d6f1
Create Date: 2026-11-07 16:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f2c8d5a1b7e3"
down_revision: Union[str, Sequence[str], None] = "e4a7c2b9d6f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ask_messages",
        sa.Column("extras", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    )
    op.create_table(
        "money_profiles",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("monthly_income_paise", sa.BigInteger(), nullable=True),
        sa.Column("income_note", sa.String(length=200), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_money_profiles_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_money_profiles")),
    )
    op.create_table(
        "commitments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("monthly_paise", sa.BigInteger(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("total_paise", sa.BigInteger(), nullable=True),
        sa.Column("paid_before_paise", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("match_words", postgresql.ARRAY(sa.String(length=40)), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("rules", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("monthly_paise > 0", name=op.f("ck_commitments_monthly_positive")),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], name=op.f("fk_commitments_category_id_categories"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_commitments_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_commitments")),
    )
    op.create_table(
        "money_notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_money_notes_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_money_notes")),
    )


def downgrade() -> None:
    op.drop_table("money_notes")
    op.drop_table("commitments")
    op.drop_table("money_profiles")
    op.drop_column("ask_messages", "extras")
