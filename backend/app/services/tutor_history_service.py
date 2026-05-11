from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.models import TutorMessage


def list_tutor_history(*, db: Session, user_id: int, lesson_id: int, limit: int = 200) -> list[TutorMessage]:
    records = list(
        db.scalars(
            select(TutorMessage)
            .where(
                TutorMessage.user_id == user_id,
                TutorMessage.lesson_id == lesson_id,
            )
            .order_by(TutorMessage.created_at.asc(), TutorMessage.id.asc())
            .limit(limit)
        )
    )
    return records


def append_tutor_turn(
    *,
    db: Session,
    user_id: int,
    lesson_id: int,
    user_content: str,
    assistant_content: str,
) -> None:
    normalized_user = (user_content or "").strip()
    normalized_assistant = (assistant_content or "").strip()
    if not normalized_user or not normalized_assistant:
        return

    try:
        db.add(
            TutorMessage(
                user_id=user_id,
                lesson_id=lesson_id,
                role="user",
                content=normalized_user,
            )
        )
        db.add(
            TutorMessage(
                user_id=user_id,
                lesson_id=lesson_id,
                role="assistant",
                content=normalized_assistant,
            )
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=409,
            message="Failed to persist tutor chat messages",
            detail={"code": "TUTOR_HISTORY_PERSIST_FAILED"},
        ) from exc
