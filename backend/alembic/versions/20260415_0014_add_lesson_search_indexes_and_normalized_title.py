"""add lesson search indexes and normalized title

Revision ID: 20260415_0014
Revises: 20260413_0013
Create Date: 2026-04-15 20:05:00
"""

from __future__ import annotations

from collections.abc import Sequence
import re
import unicodedata

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260415_0014"
down_revision: str | None = "20260413_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(column.get("name") == column_name for column in inspector.get_columns(table_name))


def _has_index(inspector: sa.Inspector, table_name: str, index_name: str) -> bool:
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def _normalize_title_for_search(raw_title: str) -> str:
    collapsed = re.sub(r"\s+", " ", (raw_title or "").strip()).lower()
    folded = unicodedata.normalize("NFD", collapsed)
    without_marks = "".join(ch for ch in folded if unicodedata.category(ch) != "Mn")
    return without_marks.replace("đ", "d")


def _backfill_title_normalized(bind: sa.Connection) -> None:
    rows = bind.execute(sa.text("SELECT id, title FROM lessons")).mappings().all()
    if not rows:
        return

    update_stmt = sa.text("UPDATE lessons SET title_normalized = :title_normalized WHERE id = :id")
    for row in rows:
        bind.execute(
            update_stmt,
            {
                "id": row["id"],
                "title_normalized": _normalize_title_for_search(str(row.get("title") or "")),
            },
        )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "lessons" not in set(inspector.get_table_names()):
        return

    if not _has_column(inspector, "lessons", "title_normalized"):
        op.add_column("lessons", sa.Column("title_normalized", sa.String(length=255), nullable=True))

    _backfill_title_normalized(bind)

    inspector = sa.inspect(bind)
    if _has_column(inspector, "lessons", "title_normalized"):
        op.alter_column(
            "lessons",
            "title_normalized",
            existing_type=sa.String(length=255),
            nullable=False,
            existing_nullable=True,
        )

    inspector = sa.inspect(bind)
    if not _has_index(inspector, "lessons", "ix_lessons_title"):
        op.create_index("ix_lessons_title", "lessons", ["title"], unique=False)

    inspector = sa.inspect(bind)
    if not _has_index(inspector, "lessons", "ix_lessons_created_at"):
        op.create_index("ix_lessons_created_at", "lessons", ["created_at"], unique=False)

    inspector = sa.inspect(bind)
    if not _has_index(inspector, "lessons", "ix_lessons_title_normalized"):
        op.create_index("ix_lessons_title_normalized", "lessons", ["title_normalized"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "lessons" not in set(inspector.get_table_names()):
        return

    if _has_index(inspector, "lessons", "ix_lessons_title_normalized"):
        op.drop_index("ix_lessons_title_normalized", table_name="lessons")

    inspector = sa.inspect(bind)
    if _has_index(inspector, "lessons", "ix_lessons_created_at"):
        op.drop_index("ix_lessons_created_at", table_name="lessons")

    inspector = sa.inspect(bind)
    if _has_index(inspector, "lessons", "ix_lessons_title"):
        op.drop_index("ix_lessons_title", table_name="lessons")

    inspector = sa.inspect(bind)
    if _has_column(inspector, "lessons", "title_normalized"):
        op.drop_column("lessons", "title_normalized")
