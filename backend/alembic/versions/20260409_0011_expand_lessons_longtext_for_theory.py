"""expand lessons text capacity for theory content

Revision ID: 20260409_0011
Revises: 20260407_0010
Create Date: 2026-04-09 16:55:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


# revision identifiers, used by Alembic.
revision: str = "20260409_0011"
down_revision: str | None = "20260407_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _target_text_type(dialect_name: str, *, upgrade_mode: bool) -> sa.types.TypeEngine:
    if dialect_name == "mysql":
        return mysql.LONGTEXT() if upgrade_mode else mysql.TEXT()
    return sa.Text()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_table(inspector, "lessons"):
        return

    target_type = _target_text_type(bind.dialect.name, upgrade_mode=True)

    op.alter_column(
        "lessons",
        "source_content",
        existing_type=sa.Text(),
        type_=target_type,
        existing_nullable=False,
    )
    op.alter_column(
        "lessons",
        "content_markdown",
        existing_type=sa.Text(),
        type_=target_type,
        existing_nullable=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_table(inspector, "lessons"):
        return

    target_type = _target_text_type(bind.dialect.name, upgrade_mode=False)

    op.alter_column(
        "lessons",
        "source_content",
        existing_type=sa.Text(),
        type_=target_type,
        existing_nullable=False,
    )
    op.alter_column(
        "lessons",
        "content_markdown",
        existing_type=sa.Text(),
        type_=target_type,
        existing_nullable=True,
    )
