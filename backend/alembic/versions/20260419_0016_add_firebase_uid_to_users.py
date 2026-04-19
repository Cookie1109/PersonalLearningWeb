"""add firebase uid to users

Revision ID: 20260419_0016
Revises: 20260418_0015
Create Date: 2026-04-19 14:30:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260419_0016"
down_revision: str | None = "20260418_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(column.get("name") == column_name for column in inspector.get_columns(table_name))


def _has_index(inspector: sa.Inspector, table_name: str, index_name: str) -> bool:
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in set(inspector.get_table_names()):
        return

    if not _has_column(inspector, "users", "firebase_uid"):
        op.add_column("users", sa.Column("firebase_uid", sa.String(length=128), nullable=True))

    inspector = sa.inspect(bind)
    if not _has_index(inspector, "users", "ix_users_firebase_uid"):
        op.create_index("ix_users_firebase_uid", "users", ["firebase_uid"], unique=True)

    password_hash_column = next(
        (column for column in inspector.get_columns("users") if column.get("name") == "password_hash"),
        None,
    )
    if password_hash_column and not password_hash_column.get("nullable", False):
        op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in set(inspector.get_table_names()):
        return

    password_hash_column = next(
        (column for column in inspector.get_columns("users") if column.get("name") == "password_hash"),
        None,
    )
    if password_hash_column and password_hash_column.get("nullable", True):
        op.execute("UPDATE users SET password_hash = '' WHERE password_hash IS NULL")
        op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=False)

    inspector = sa.inspect(bind)
    if _has_index(inspector, "users", "ix_users_firebase_uid"):
        op.drop_index("ix_users_firebase_uid", table_name="users")

    if _has_column(inspector, "users", "firebase_uid"):
        op.drop_column("users", "firebase_uid")
