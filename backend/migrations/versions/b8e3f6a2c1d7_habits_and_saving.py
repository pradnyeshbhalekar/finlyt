"""small habits (what I decided about each) and a saving target

Revision ID: b8e3f6a2c1d7
Revises: a6d1f4c8e2b0
Create Date: 2026-11-17 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8e3f6a2c1d7"
down_revision: Union[str, Sequence[str], None] = "a6d1f4c8e2b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "habit_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=60), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column("times_per_week", sa.SmallInteger(), nullable=True),
        sa.Column("paise_per_week", sa.BigInteger(), nullable=True),
        sa.Column("baseline_paise_per_week", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("goal_id", sa.Integer(), nullable=True),
        sa.Column("decided_on", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('limit', 'keep', 'need', 'later')", name=op.f("ck_habit_rules_status")),
        sa.CheckConstraint(
            "times_per_week IS NULL OR times_per_week BETWEEN 0 AND 50", name=op.f("ck_habit_rules_times_range")
        ),
        sa.CheckConstraint("paise_per_week IS NULL OR paise_per_week > 0", name=op.f("ck_habit_rules_budget_positive")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_habit_rules_user_id_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], name=op.f("fk_habit_rules_goal_id_goals"), ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_habit_rules")),
        sa.UniqueConstraint("user_id", "key", name=op.f("uq_habit_rules_user_id_key")),
    )
    op.add_column("money_profiles", sa.Column("saving_target_paise", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("money_profiles", "saving_target_paise")
    op.drop_table("habit_rules")
