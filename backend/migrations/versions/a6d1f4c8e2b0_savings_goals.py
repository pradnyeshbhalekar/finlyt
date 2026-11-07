"""savings goals and the money put towards them

Revision ID: a6d1f4c8e2b0
Revises: f2c8d5a1b7e3
Create Date: 2026-11-07 14:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a6d1f4c8e2b0"
down_revision: Union[str, Sequence[str], None] = "f2c8d5a1b7e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "goals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("target_paise", sa.BigInteger(), nullable=False),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("target_paise > 0", name=op.f("ck_goals_target_positive")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_goals_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_goals")),
    )
    op.create_table(
        "goal_deposits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("note", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount_paise <> 0", name=op.f("ck_goal_deposits_amount_nonzero")),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], name=op.f("fk_goal_deposits_goal_id_goals"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_goal_deposits")),
    )
    op.create_index(op.f("ix_goal_deposits_goal_id"), "goal_deposits", ["goal_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_goal_deposits_goal_id"), table_name="goal_deposits")
    op.drop_table("goal_deposits")
    op.drop_table("goals")
