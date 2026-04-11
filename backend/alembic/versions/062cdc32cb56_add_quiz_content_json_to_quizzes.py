"""add quiz_content json to quizzes

Revision ID: 062cdc32cb56
Revises: 20260409_0011
Create Date: 2026-04-11 17:30:52.935464
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '062cdc32cb56'
down_revision = '20260409_0011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('quizzes', sa.Column('quiz_content', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('quizzes', 'quiz_content')
