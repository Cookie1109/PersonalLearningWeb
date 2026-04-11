"""add selected answers and generation marker to quiz attempts

Revision ID: 20260411_0012
Revises: 062cdc32cb56
Create Date: 2026-04-11 19:20:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260411_0012"
down_revision: str | None = "062cdc32cb56"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    table_names = set(inspector.get_table_names())
    if "quiz_attempts" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("quiz_attempts")}

    if "selected_answers" not in columns:
        op.add_column("quiz_attempts", sa.Column("selected_answers", sa.JSON(), nullable=True))

    if "generation_marker" not in columns:
        op.add_column("quiz_attempts", sa.Column("generation_marker", sa.String(length=64), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    table_names = set(inspector.get_table_names())
    if "quiz_attempts" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("quiz_attempts")}

    if "generation_marker" in columns:
        op.drop_column("quiz_attempts", "generation_marker")

    if "selected_answers" in columns:
        op.drop_column("quiz_attempts", "selected_answers")
