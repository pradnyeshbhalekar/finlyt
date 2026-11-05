"""planning: monthly budgets, check-in plans and planned items

Revision ID: a3c9e1f2b7d4
Revises: 679d931f7960
Create Date: 2026-11-05 21:30:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a3c9e1f2b7d4"
down_revision: Union[str, Sequence[str], None] = "679d931f7960"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "budgets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount_paise > 0", name=op.f("ck_budgets_amount_positive")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_budgets_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budgets")),
        sa.UniqueConstraint("user_id", "month", name="uq_budgets_user_month"),
    )
    op.create_table(
        "plans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("daily_limit_paise", sa.BigInteger(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("daily_limit_paise > 0", name=op.f("ck_plans_daily_limit_positive")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_plans_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plans")),
        sa.UniqueConstraint("user_id", "starts_on", name="uq_plans_user_starts_on"),
    )
    op.create_table(
        "planned_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("description", sa.String(length=200), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount_paise > 0", name=op.f("ck_planned_items_amount_positive")),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], name=op.f("fk_planned_items_category_id_categories"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_planned_items_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_planned_items")),
    )
    op.create_index("ix_planned_items_user_month", "planned_items", ["user_id", "month"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_planned_items_user_month", table_name="planned_items")
    op.drop_table("planned_items")
    op.drop_table("plans")
    op.drop_table("budgets")
