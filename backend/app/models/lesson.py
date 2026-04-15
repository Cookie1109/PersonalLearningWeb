from datetime import datetime
import re
import unicodedata

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.db.base import Base


def _lesson_content_text_type() -> Text:
    return Text().with_variant(mysql.LONGTEXT(), "mysql")


def normalize_lesson_title_for_search(raw_title: str) -> str:
    collapsed = re.sub(r"\s+", " ", (raw_title or "").strip()).lower()
    folded = unicodedata.normalize("NFD", collapsed)
    without_marks = "".join(ch for ch in folded if unicodedata.category(ch) != "Mn")
    return without_marks.replace("đ", "d")


class Lesson(Base):
    __tablename__ = "lessons"
    __table_args__ = (
        UniqueConstraint("user_id", "title", name="uq_lessons_user_title"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    roadmap_id: Mapped[int | None] = mapped_column(ForeignKey("roadmaps.id", ondelete="SET NULL"), index=True, nullable=True)
    week_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    title: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    title_normalized: Mapped[str] = mapped_column(String(255), nullable=False, default="", index=True)
    source_content: Mapped[str] = mapped_column(_lesson_content_text_type(), nullable=False, default="")
    source_file_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    source_file_public_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_file_mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    content_markdown: Mapped[str | None] = mapped_column(_lesson_content_text_type(), nullable=True)
    youtube_video_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user = relationship("User", back_populates="lessons")
    roadmap = relationship("Roadmap", back_populates="lessons")
    exp_entries = relationship("ExpLedger", back_populates="lesson")
    quiz = relationship("Quiz", back_populates="lesson", uselist=False, cascade="all, delete-orphan")

    @validates("title")
    def _sync_title_normalized(self, _key: str, title: str) -> str:
        normalized_title = (title or "").strip()
        self.title_normalized = normalize_lesson_title_for_search(normalized_title)
        return normalized_title
