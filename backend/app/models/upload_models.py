from datetime import datetime
from sqlalchemy import DateTime, Integer, String, Text, ForeignKey, ForeignKeyConstraint, func, JSON
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _longtext_type() -> Text:
    return Text().with_variant(mysql.LONGTEXT(), "mysql")


class MySQLDocument(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    mysql_lesson_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_content: Mapped[str] = mapped_column(_longtext_type(), nullable=False)
    content_markdown: Mapped[str | None] = mapped_column(_longtext_type(), nullable=True)
    source_file_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    source_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_file_mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class MySQLDocumentHash(Base):
    __tablename__ = "document_hash"

    hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MySQLCacheHit(Base):
    __tablename__ = "cache_hit"
    __table_args__ = (
        ForeignKeyConstraint(
            ["hash", "user_id"],
            ["document_hash.hash", "document_hash.user_id"],
            ondelete="CASCADE",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hit_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    last_hit_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class MySQLAIJob(Base):
    __tablename__ = "ai_jobs"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    job_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    payload: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    result: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
