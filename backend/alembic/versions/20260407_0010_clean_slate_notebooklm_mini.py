"""clean slate reset for notebooklm mini

Revision ID: 20260407_0010
Revises: 20260407_0009
Create Date: 2026-04-07 09:20:00.000000
"""

from collections.abc import Sequence

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260407_0010"
down_revision: str | None = "20260407_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


REQUIRED_CONFIRM_FLAG = "NOTEBOOKLM_MINI_CLEAN_SLATE"


def _require_clean_slate_confirmation() -> None:
    x_args = context.get_x_argument(as_dictionary=True)
    confirmation = (x_args.get("clean_slate_confirm") or "").strip()
    if confirmation != REQUIRED_CONFIRM_FLAG:
        raise RuntimeError(
            "Refusing to run destructive clean-slate migration. "
            "Re-run with: alembic -x clean_slate_confirm=NOTEBOOKLM_MINI_CLEAN_SLATE upgrade head"
        )


def _has_table(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _has_unique(inspector: sa.Inspector, table_name: str, unique_name: str) -> bool:
    return any(constraint.get("name") == unique_name for constraint in inspector.get_unique_constraints(table_name))


def upgrade() -> None:
    _require_clean_slate_confirmation()

    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table_name in (
        "quiz_attempts",
        "questions",
        "quizzes",
        "flashcard_progress",
        "exp_ledger",
        "lessons",
        "roadmaps",
    ):
        if _has_table(inspector, table_name):
            op.execute(sa.text(f"DELETE FROM {table_name}"))

    if _has_table(inspector, "users"):
        op.execute(
            sa.text(
                """
                UPDATE users
                SET
                    exp = 0,
                    total_exp = 0,
                    level = 1,
                    current_streak = 0,
                    streak = 0,
                    last_study_date = NULL
                """
            )
        )

    if _has_table(inspector, "lessons"):
        if _has_unique(inspector, "lessons", "uq_lessons_roadmap_week_position"):
            op.drop_constraint("uq_lessons_roadmap_week_position", table_name="lessons", type_="unique")

        if not _has_unique(inspector, "lessons", "uq_lessons_user_title"):
            op.create_unique_constraint("uq_lessons_user_title", "lessons", ["user_id", "title"])


def downgrade() -> None:
    # Irreversible by design: data was intentionally reset.
    pass
