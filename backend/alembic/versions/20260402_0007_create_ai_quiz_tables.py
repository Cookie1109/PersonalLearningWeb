"""create ai quiz tables

Revision ID: 20260402_0007
Revises: 20260402_0006
Create Date: 2026-04-02 15:30:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260402_0007"
down_revision: str | None = "20260402_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "quizzes" not in table_names:
        op.create_table(
            "quizzes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("lesson_id", sa.Integer(), nullable=False),
            sa.Column("model_name", sa.String(length=100), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("lesson_id", name="uq_quizzes_lesson_id"),
        )
        op.create_index("ix_quizzes_lesson_id", "quizzes", ["lesson_id"], unique=False)

    table_names = set(sa.inspect(bind).get_table_names())
    if "questions" not in table_names:
        op.create_table(
            "questions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("quiz_id", sa.Integer(), nullable=False),
            sa.Column("question_text", sa.Text(), nullable=False),
            sa.Column("options_json", sa.JSON(), nullable=False),
            sa.Column("correct_index", sa.Integer(), nullable=False),
            sa.Column("explanation", sa.Text(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["quiz_id"], ["quizzes.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("quiz_id", "position", name="uq_questions_quiz_position"),
        )
        op.create_index("ix_questions_quiz_id", "questions", ["quiz_id"], unique=False)

    table_names = set(sa.inspect(bind).get_table_names())
    if "quiz_attempts" in table_names:
        op.drop_table("quiz_attempts")

    table_names = set(sa.inspect(bind).get_table_names())
    if "quiz_attempts" not in table_names:
        op.create_table(
            "quiz_attempts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("quiz_id", sa.Integer(), nullable=False),
            sa.Column("score", sa.Integer(), nullable=False),
            sa.Column("passed", sa.Boolean(), nullable=False),
            sa.Column("reward_granted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("answers_json", sa.JSON(), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["quiz_id"], ["quizzes.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_quiz_attempts_user_quiz", "quiz_attempts", ["user_id", "quiz_id"], unique=False)

    table_names = set(sa.inspect(bind).get_table_names())
    if "quiz_items" in table_names:
        op.drop_table("quiz_items")


def downgrade() -> None:
    bind = op.get_bind()
    table_names = set(sa.inspect(bind).get_table_names())

    if "quiz_items" not in table_names:
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

    table_names = set(sa.inspect(bind).get_table_names())
    if "quiz_attempts" in table_names:
        op.drop_table("quiz_attempts")

    table_names = set(sa.inspect(bind).get_table_names())
    if "quiz_attempts" not in table_names:
        op.create_table(
            "quiz_attempts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("lesson_id", sa.Integer(), nullable=False),
            sa.Column("quiz_id", sa.String(length=100), nullable=False),
            sa.Column("score", sa.Integer(), nullable=False),
            sa.Column("is_passed", sa.Boolean(), nullable=False),
            sa.Column("attempt_no", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("cooldown_until", sa.DateTime(timezone=True), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_quiz_attempts_user_lesson", "quiz_attempts", ["user_id", "lesson_id"], unique=False)

    table_names = set(sa.inspect(bind).get_table_names())
    if "questions" in table_names:
        op.drop_table("questions")

    table_names = set(sa.inspect(bind).get_table_names())
    if "quizzes" in table_names:
        op.drop_table("quizzes")
