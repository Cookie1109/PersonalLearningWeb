"""flatten lessons for document workspace

Revision ID: 20260407_0009
Revises: 20260406_0008
Create Date: 2026-04-07 09:10:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260407_0009"
down_revision: str | None = "20260406_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(column.get("name") == column_name for column in inspector.get_columns(table_name))


def _has_index(inspector: sa.Inspector, table_name: str, index_name: str) -> bool:
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def _has_fk(inspector: sa.Inspector, table_name: str, fk_name: str) -> bool:
    return any(fk.get("name") == fk_name for fk in inspector.get_foreign_keys(table_name))


def _drop_unique_if_exists(inspector: sa.Inspector, table_name: str, constraint_name: str) -> None:
    unique_names = {constraint.get("name") for constraint in inspector.get_unique_constraints(table_name)}
    if constraint_name in unique_names:
        op.drop_constraint(constraint_name, table_name=table_name, type_="unique")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "lessons" not in table_names:
        return

    if not _has_column(inspector, "lessons", "user_id"):
        op.add_column("lessons", sa.Column("user_id", sa.Integer(), nullable=True))

    if not _has_column(inspector, "lessons", "source_content"):
        # MySQL (especially older variants) does not allow defaults on TEXT columns.
        op.add_column("lessons", sa.Column("source_content", sa.Text(), nullable=True))

    inspector = sa.inspect(bind)
    if not _has_fk(inspector, "lessons", "fk_lessons_user_id_users"):
        op.create_foreign_key(
            "fk_lessons_user_id_users",
            "lessons",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )

    dialect = bind.dialect.name
    if dialect == "sqlite":
        op.execute(
            """
            UPDATE lessons
            SET user_id = (
                SELECT roadmaps.user_id
                FROM roadmaps
                WHERE roadmaps.id = lessons.roadmap_id
            )
            WHERE user_id IS NULL
            """
        )
    else:
        op.execute(
            """
            UPDATE lessons l
            JOIN roadmaps r ON r.id = l.roadmap_id
            SET l.user_id = r.user_id
            WHERE l.user_id IS NULL
            """
        )

    op.execute("UPDATE lessons SET source_content = '' WHERE source_content IS NULL")

    try:
        op.alter_column("lessons", "roadmap_id", existing_type=sa.Integer(), nullable=True)
    except Exception:
        # Keep migration resilient across dialects where FK/nullable alter requires manual SQL.
        pass

    try:
        op.alter_column("lessons", "user_id", existing_type=sa.Integer(), nullable=False)
    except Exception:
        # If there are legacy orphan lessons, clean-slate migration will reset data next revision.
        pass

    try:
        op.alter_column("lessons", "source_content", existing_type=sa.Text(), nullable=False)
    except Exception:
        # Keep migration resilient across dialect differences.
        pass

    inspector = sa.inspect(bind)
    if not _has_index(inspector, "lessons", "ix_lessons_user_id"):
        op.create_index("ix_lessons_user_id", "lessons", ["user_id"], unique=False)

    _drop_unique_if_exists(inspector, "lessons", "uq_lessons_roadmap_week_position")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "lessons" not in table_names:
        return

    if _has_index(inspector, "lessons", "ix_lessons_user_id"):
        op.drop_index("ix_lessons_user_id", table_name="lessons")

    if _has_fk(inspector, "lessons", "fk_lessons_user_id_users"):
        op.drop_constraint("fk_lessons_user_id_users", table_name="lessons", type_="foreignkey")

    if _has_column(inspector, "lessons", "source_content"):
        op.drop_column("lessons", "source_content")

    if _has_column(inspector, "lessons", "user_id"):
        op.drop_column("lessons", "user_id")

    inspector = sa.inspect(bind)
    unique_names = {constraint.get("name") for constraint in inspector.get_unique_constraints("lessons")}
    if "uq_lessons_roadmap_week_position" not in unique_names:
        op.create_unique_constraint(
            "uq_lessons_roadmap_week_position",
            "lessons",
            ["roadmap_id", "week_number", "position"],
        )
