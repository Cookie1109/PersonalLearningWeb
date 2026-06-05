from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, Integer, String, Float, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ConceptTag(Base):
    __tablename__ = "concept_tags"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_user_tag_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    user = relationship("User")
    lessons = relationship("Lesson", secondary="lesson_tags", back_populates="concept_tags")
    flashcards = relationship("Flashcard", secondary="flashcard_tags", back_populates="concept_tags")
    weakness = relationship("ConceptWeakness", back_populates="tag", cascade="all, delete-orphan", uselist=False)


class ConceptEdge(Base):
    __tablename__ = "concept_edges"
    __table_args__ = (
        UniqueConstraint("user_id", "source_tag_id", "target_tag_id", name="uq_user_source_target"),
        CheckConstraint("source_tag_id != target_tag_id", name="ck_no_self_loop"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    source_tag_id: Mapped[int] = mapped_column(ForeignKey("concept_tags.id", ondelete="CASCADE"), nullable=False)
    target_tag_id: Mapped[int] = mapped_column(ForeignKey("concept_tags.id", ondelete="CASCADE"), nullable=False)
    weight: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    relationship_type: Mapped[str] = mapped_column(String(50), default="related_to", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    user = relationship("User")
    source_tag = relationship("ConceptTag", foreign_keys=[source_tag_id])
    target_tag = relationship("ConceptTag", foreign_keys=[target_tag_id])


class ConceptWeakness(Base):
    __tablename__ = "concept_weakness"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("concept_tags.id", ondelete="CASCADE"), primary_key=True)
    weakness_score: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    card_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    user = relationship("User")
    tag = relationship("ConceptTag", back_populates="weakness")


class FSRSCard(Base):
    __tablename__ = "fsrs_cards"

    card_id: Mapped[int] = mapped_column(ForeignKey("flashcards.id", ondelete="CASCADE"), primary_key=True)
    state: Mapped[int] = mapped_column(Integer, default=1, nullable=False) # 1: Learning, 2: Review, 3: Relearning
    step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    due: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_review: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    flashcard = relationship("Flashcard", back_populates="fsrs_card")


class FSRSReview(Base):
    __tablename__ = "fsrs_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("flashcards.id", ondelete="CASCADE"), nullable=False, index=True)
    rating: Mapped[int] = mapped_column(Integer, nullable=False) # 1: Again, 2: Hard, 3: Good, 4: Easy
    review_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    review_duration: Mapped[int | None] = mapped_column(Integer, nullable=True) # in milliseconds

    # Relationships
    flashcard = relationship("Flashcard")


# Junction tables defined using Imperative table syntax or simple classes for metadata creation
class LessonTag(Base):
    __tablename__ = "lesson_tags"
    lesson_id: Mapped[int] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("concept_tags.id", ondelete="CASCADE"), primary_key=True)


class FlashcardTag(Base):
    __tablename__ = "flashcard_tags"
    flashcard_id: Mapped[int] = mapped_column(ForeignKey("flashcards.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("concept_tags.id", ondelete="CASCADE"), primary_key=True)
