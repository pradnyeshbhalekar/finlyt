"""debts: money I owe other people

Revision ID: b7e2d4c9a1f3
Revises: a3c9e1f2b7d4
Create Date: 2026-11-05 23:10:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7e2d4c9a1f3"
down_revision: Union[str, Sequence[str], None] = "a3c9e1f2b7d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "debts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("person_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(length=200), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'open'"), nullable=False),
        sa.Column("note_raw", sa.Text(), nullable=True),
        sa.Column("expense_id", sa.Integer(), nullable=True),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount_paise > 0", name=op.f("ck_debts_amount_positive")),
        sa.CheckConstraint("status IN ('open', 'settled')", name=op.f("ck_debts_status")),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], name=op.f("fk_debts_category_id_categories"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["expense_id"], ["expenses.id"], name=op.f("fk_debts_expense_id_expenses"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["person_id"], ["people.id"], name=op.f("fk_debts_person_id_people")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_debts_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_debts")),
    )
    op.create_index("ix_debts_user_status", "debts", ["user_id", "status"], unique=False)
    op.create_index(op.f("ix_debts_person_id"), "debts", ["person_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_debts_person_id"), table_name="debts")
    op.drop_index("ix_debts_user_status", table_name="debts")
    op.drop_table("debts")
