"""add tutor messages table

Revision ID: 20260511_0019
Revises: 20260419_0018
Create Date: 2026-05-11 09:30:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260511_0019"
down_revision: str | None = "20260419_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tutor_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("lesson_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("role IN ('user', 'assistant')", name="ck_tutor_messages_role"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_tutor_messages_user_id", "tutor_messages", ["user_id"], unique=False)
    op.create_index("ix_tutor_messages_lesson_id", "tutor_messages", ["lesson_id"], unique=False)
    op.create_index(
        "ix_tutor_messages_user_lesson_created",
        "tutor_messages",
        ["user_id", "lesson_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_tutor_messages_user_lesson_created", table_name="tutor_messages")
    op.drop_index("ix_tutor_messages_lesson_id", table_name="tutor_messages")
    op.drop_index("ix_tutor_messages_user_id", table_name="tutor_messages")
    op.drop_table("tutor_messages")
