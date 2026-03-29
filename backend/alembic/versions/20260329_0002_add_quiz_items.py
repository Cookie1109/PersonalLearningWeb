"""add quiz item answer key table

Revision ID: 20260329_0002
Revises: 20260328_0001
Create Date: 2026-03-29 09:00:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260329_0002"
down_revision: str | None = "20260328_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "quiz_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("lesson_id", sa.Integer(), nullable=False),
        sa.Column("quiz_id", sa.String(length=100), nullable=False),
        sa.Column("question_id", sa.String(length=100), nullable=False),
        sa.Column("correct_option", sa.String(length=10), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("quiz_id", "question_id", name="uq_quiz_items_quiz_question"),
    )
    op.create_index("ix_quiz_items_lesson_id", "quiz_items", ["lesson_id"], unique=False)
    op.create_index("ix_quiz_items_quiz_id", "quiz_items", ["quiz_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_quiz_items_quiz_id", table_name="quiz_items")
    op.drop_index("ix_quiz_items_lesson_id", table_name="quiz_items")
    op.drop_table("quiz_items")
