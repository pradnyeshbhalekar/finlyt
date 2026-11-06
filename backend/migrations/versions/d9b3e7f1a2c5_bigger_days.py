"""bigger days and a chosen check-in day: usual and bigger-day limits, check-in weekday,
answer options on Ask messages

Revision ID: d9b3e7f1a2c5
Revises: c4f8a2e6d913
Create Date: 2026-11-07 12:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d9b3e7f1a2c5"
down_revision: Union[str, Sequence[str], None] = "c4f8a2e6d913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("check_in_weekday", sa.SmallInteger(), server_default=sa.text("6"), nullable=False))
    op.add_column("plans", sa.Column("big_day_limit_paise", sa.BigInteger(), nullable=True))
    op.add_column("plans", sa.Column("big_days_per_week", sa.SmallInteger(), server_default=sa.text("0"), nullable=False))
    op.create_check_constraint(op.f("ck_plans_big_days_range"), "plans", "big_days_per_week BETWEEN 0 AND 6")
    op.add_column(
        "ask_messages",
        sa.Column("options", postgresql.ARRAY(sa.String(length=120)), server_default=sa.text("'{}'"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("ask_messages", "options")
    op.drop_constraint(op.f("ck_plans_big_days_range"), "plans", type_="check")
    op.drop_column("plans", "big_days_per_week")
    op.drop_column("plans", "big_day_limit_paise")
    op.drop_column("users", "check_in_weekday")
