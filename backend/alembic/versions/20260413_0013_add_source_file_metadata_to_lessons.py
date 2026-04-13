"""add source file metadata columns to lessons

Revision ID: 20260413_0013
Revises: 20260411_0012
Create Date: 2026-04-13 09:30:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260413_0013"
down_revision: str | None = "20260411_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(column.get("name") == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    table_names = set(inspector.get_table_names())
    if "lessons" not in table_names:
        return

    if not _has_column(inspector, "lessons", "source_file_url"):
        op.add_column("lessons", sa.Column("source_file_url", sa.String(length=1024), nullable=True))

    inspector = sa.inspect(bind)
    if not _has_column(inspector, "lessons", "source_file_public_id"):
        op.add_column("lessons", sa.Column("source_file_public_id", sa.String(length=255), nullable=True))

    inspector = sa.inspect(bind)
    if not _has_column(inspector, "lessons", "source_file_name"):
        op.add_column("lessons", sa.Column("source_file_name", sa.String(length=255), nullable=True))

    inspector = sa.inspect(bind)
    if not _has_column(inspector, "lessons", "source_file_mime_type"):
        op.add_column("lessons", sa.Column("source_file_mime_type", sa.String(length=128), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    table_names = set(inspector.get_table_names())
    if "lessons" not in table_names:
        return

    if _has_column(inspector, "lessons", "source_file_mime_type"):
        op.drop_column("lessons", "source_file_mime_type")

    inspector = sa.inspect(bind)
    if _has_column(inspector, "lessons", "source_file_name"):
        op.drop_column("lessons", "source_file_name")

    inspector = sa.inspect(bind)
    if _has_column(inspector, "lessons", "source_file_public_id"):
        op.drop_column("lessons", "source_file_public_id")

    inspector = sa.inspect(bind)
    if _has_column(inspector, "lessons", "source_file_url"):
        op.drop_column("lessons", "source_file_url")
