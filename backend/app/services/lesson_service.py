from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.models import ExpLedger, Lesson, Roadmap, User
from app.schemas import LessonCompleteResponseDTO

LESSON_COMPLETE_REWARD_TYPE = "lesson_complete"


def complete_lesson_for_user(
    *,
    db: Session,
    user_id: int,
    lesson_id: int,
    reward_exp: int,
) -> LessonCompleteResponseDTO:
    lesson = db.scalar(
        select(Lesson)
        .join(Roadmap, Lesson.roadmap_id == Roadmap.id)
        .where(and_(Lesson.id == lesson_id, Roadmap.user_id == user_id))
    )
    if lesson is None:
        raise AppException(status_code=404, message="Lesson not found", detail={"code": "LESSON_NOT_FOUND"})

    try:
        locked_user = db.scalar(select(User).where(User.id == user_id).with_for_update())
        if locked_user is None:
            raise AppException(status_code=401, message="User not found", detail={"code": "USER_NOT_FOUND"})

        existing_reward = db.scalar(
            select(ExpLedger).where(
                and_(
                    ExpLedger.user_id == user_id,
                    ExpLedger.lesson_id == lesson_id,
                    ExpLedger.reward_type == LESSON_COMPLETE_REWARD_TYPE,
                )
            )
        )

        if existing_reward is not None:
            if not lesson.is_completed:
                lesson.is_completed = True
                lesson.completed_at = datetime.now(UTC)
                db.commit()

            return LessonCompleteResponseDTO(
                lesson_id=lesson_id,
                exp_earned=0,
                total_exp=locked_user.total_exp,
                already_completed=True,
                message="Lesson already completed",
            )

        lesson.is_completed = True
        lesson.completed_at = datetime.now(UTC)

        reward_entry = ExpLedger(
            user_id=user_id,
            lesson_id=lesson_id,
            quiz_id=None,
            reward_type=LESSON_COMPLETE_REWARD_TYPE,
            exp_amount=reward_exp,
            metadata_json={"source": LESSON_COMPLETE_REWARD_TYPE},
        )

        locked_user.total_exp += reward_exp
        db.add(reward_entry)
        db.commit()
        db.refresh(locked_user)

        return LessonCompleteResponseDTO(
            lesson_id=lesson_id,
            exp_earned=reward_exp,
            total_exp=locked_user.total_exp,
            already_completed=False,
            message="Lesson completed",
        )
    except AppException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise AppException(status_code=409, message="Lesson completion failed", detail={"code": "LESSON_COMPLETE_FAILED", "error": str(exc)}) from exc
