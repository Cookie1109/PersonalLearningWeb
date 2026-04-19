"""add daily quests and exp tracking columns

Revision ID: 20260419_0018
Revises: 20260419_0017
Create Date: 2026-04-19 23:35:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260419_0018"
down_revision: str | None = "20260419_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(column.get("name") == column_name for column in inspector.get_columns(table_name))


def _has_index(inspector: sa.Inspector, table_name: str, index_name: str) -> bool:
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def _has_unique_constraint(inspector: sa.Inspector, table_name: str, constraint_name: str) -> bool:
    return any(constraint.get("name") == constraint_name for constraint in inspector.get_unique_constraints(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "daily_quests"):
        op.create_table(
            "daily_quests",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("quest_code", sa.String(length=64), nullable=False),
            sa.Column("difficulty", sa.String(length=16), nullable=False),
            sa.Column("action_type", sa.String(length=64), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("target_value", sa.Integer(), nullable=False),
            sa.Column("current_progress", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("exp_reward", sa.Integer(), nullable=False),
            sa.Column("quest_date", sa.Date(), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
                onupdate=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "quest_code", "quest_date", name="uq_daily_quests_user_code_date"),
        )
        op.create_index("ix_daily_quests_user_id", "daily_quests", ["user_id"], unique=False)
        op.create_index("ix_daily_quests_quest_date", "daily_quests", ["quest_date"], unique=False)

    inspector = sa.inspect(bind)
    if _has_table(inspector, "exp_ledger"):
        if not _has_column(inspector, "exp_ledger", "action_type"):
            op.add_column(
                "exp_ledger",
                sa.Column("action_type", sa.String(length=64), nullable=False, server_default="legacy"),
            )

        if not _has_column(inspector, "exp_ledger", "target_id"):
            op.add_column(
                "exp_ledger",
                sa.Column("target_id", sa.String(length=128), nullable=True),
            )

    inspector = sa.inspect(bind)
    if _has_table(inspector, "exp_ledger"):
        if not _has_index(inspector, "exp_ledger", "ix_exp_ledger_action_type"):
            op.create_index("ix_exp_ledger_action_type", "exp_ledger", ["action_type"], unique=False)

        if not _has_index(inspector, "exp_ledger", "ix_exp_ledger_target_id"):
            op.create_index("ix_exp_ledger_target_id", "exp_ledger", ["target_id"], unique=False)

        if not _has_unique_constraint(inspector, "exp_ledger", "uq_exp_ledger_user_action_target_reward"):
            op.create_unique_constraint(
                "uq_exp_ledger_user_action_target_reward",
                "exp_ledger",
                ["user_id", "action_type", "target_id", "reward_type"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "exp_ledger"):
        if _has_unique_constraint(inspector, "exp_ledger", "uq_exp_ledger_user_action_target_reward"):
            op.drop_constraint("uq_exp_ledger_user_action_target_reward", "exp_ledger", type_="unique")

        if _has_index(inspector, "exp_ledger", "ix_exp_ledger_target_id"):
            op.drop_index("ix_exp_ledger_target_id", table_name="exp_ledger")

        if _has_index(inspector, "exp_ledger", "ix_exp_ledger_action_type"):
            op.drop_index("ix_exp_ledger_action_type", table_name="exp_ledger")

        if _has_column(inspector, "exp_ledger", "target_id"):
            op.drop_column("exp_ledger", "target_id")

        if _has_column(inspector, "exp_ledger", "action_type"):
            op.drop_column("exp_ledger", "action_type")

    inspector = sa.inspect(bind)
    if _has_table(inspector, "daily_quests"):
        if _has_index(inspector, "daily_quests", "ix_daily_quests_quest_date"):
            op.drop_index("ix_daily_quests_quest_date", table_name="daily_quests")

        if _has_index(inspector, "daily_quests", "ix_daily_quests_user_id"):
            op.drop_index("ix_daily_quests_user_id", table_name="daily_quests")

        op.drop_table("daily_quests")
