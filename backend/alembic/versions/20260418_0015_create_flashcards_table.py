"""create flashcards table

Revision ID: 20260418_0015
Revises: 20260415_0014
Create Date: 2026-04-18 09:30:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260418_0015"
down_revision: str | None = "20260415_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_index(inspector: sa.Inspector, table_name: str, index_name: str) -> bool:
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "flashcards" not in table_names:
        op.create_table(
            "flashcards",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("document_id", sa.Integer(), nullable=False),
            sa.Column("front_text", sa.Text(), nullable=False),
            sa.Column("back_text", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=16), server_default="new", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.CheckConstraint("status IN ('new','got_it','missed_it')", name="ck_flashcards_status"),
            sa.ForeignKeyConstraint(["document_id"], ["lessons.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    inspector = sa.inspect(bind)
    if "flashcards" not in set(inspector.get_table_names()):
        return

    if not _has_index(inspector, "flashcards", "ix_flashcards_document_id"):
        op.create_index("ix_flashcards_document_id", "flashcards", ["document_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "flashcards" not in set(inspector.get_table_names()):
        return

    if _has_index(inspector, "flashcards", "ix_flashcards_document_id"):
        op.drop_index("ix_flashcards_document_id", table_name="flashcards")

    op.drop_table("flashcards")
