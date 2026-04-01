"""add user gamification stats

Revision ID: 20260402_0006
Revises: 20260401_0005
Create Date: 2026-04-02 09:00:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260402_0006"
down_revision: str | None = "20260401_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("exp", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("current_streak", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("last_study_date", sa.Date(), nullable=True))

    op.execute("UPDATE users SET exp = COALESCE(total_exp, 0)")
    op.execute("UPDATE users SET current_streak = COALESCE(streak, 0)")


def downgrade() -> None:
    op.drop_column("users", "last_study_date")
    op.drop_column("users", "current_streak")
    op.drop_column("users", "exp")
