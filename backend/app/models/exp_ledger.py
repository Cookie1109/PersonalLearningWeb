from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ExpLedger(Base):
    __tablename__ = "exp_ledger"
    __table_args__ = (
        UniqueConstraint("user_id", "quiz_id", "reward_type", name="uq_exp_ledger_user_quiz_reward"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    lesson_id: Mapped[int | None] = mapped_column(ForeignKey("lessons.id", ondelete="SET NULL"), nullable=True)
    quiz_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reward_type: Mapped[str] = mapped_column(String(50), nullable=False)
    exp_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    awarded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="exp_entries")
    lesson = relationship("Lesson", back_populates="exp_entries")
