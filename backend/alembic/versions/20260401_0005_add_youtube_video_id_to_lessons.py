"""add youtube video id to lessons

Revision ID: 20260401_0005
Revises: 20260331_0004
Create Date: 2026-04-01 12:00:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260401_0005"
down_revision: str | None = "20260331_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("lessons", sa.Column("youtube_video_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("lessons", "youtube_video_id")
