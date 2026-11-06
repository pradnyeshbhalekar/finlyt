"""imports from AI chats: paybacks and money owed belong to their import batch too

Revision ID: e4a7c2b9d6f1
Revises: d9b3e7f1a2c5
Create Date: 2026-11-07 14:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e4a7c2b9d6f1"
down_revision: Union[str, Sequence[str], None] = "d9b3e7f1a2c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("settlements", "debts"):
        op.add_column(table, sa.Column("import_batch_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            op.f(f"fk_{table}_import_batch_id_import_batches"),
            table,
            "import_batches",
            ["import_batch_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_index(op.f(f"ix_{table}_import_batch_id"), table, ["import_batch_id"], unique=False)


def downgrade() -> None:
    for table in ("debts", "settlements"):
        op.drop_index(op.f(f"ix_{table}_import_batch_id"), table_name=table)
        op.drop_constraint(op.f(f"fk_{table}_import_batch_id_import_batches"), table, type_="foreignkey")
        op.drop_column(table, "import_batch_id")
