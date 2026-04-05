"""add flashcard progress table

Revision ID: 20260406_0008
Revises: 20260402_0007
Create Date: 2026-04-06 02:00:38.703765
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260406_0008"
down_revision: str | None = "20260402_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "flashcard_progress" not in table_names:
        op.create_table(
            "flashcard_progress",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("lesson_id", sa.Integer(), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("user_id", "lesson_id", name="uq_flashcard_progress_user_lesson"),
        )
        op.create_index("ix_flashcard_progress_lesson_id", "flashcard_progress", ["lesson_id"], unique=False)
        op.create_index("ix_flashcard_progress_user_id", "flashcard_progress", ["user_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    table_names = set(sa.inspect(bind).get_table_names())

    if "flashcard_progress" in table_names:
        op.drop_index("ix_flashcard_progress_user_id", table_name="flashcard_progress")
        op.drop_index("ix_flashcard_progress_lesson_id", table_name="flashcard_progress")
        op.drop_table("flashcard_progress")
