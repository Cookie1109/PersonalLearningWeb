from __future__ import annotations

from fastapi import Depends
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.core.exceptions import AppException
from app.db.session import get_db
from app.models import Flashcard, Lesson, User


def get_owned_flashcard_or_404(
    card_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Flashcard:
    card = db.scalar(
        select(Flashcard)
        .join(Lesson, Flashcard.document_id == Lesson.id)
        .where(
            and_(
                Flashcard.id == card_id,
                Lesson.user_id == current_user.id,
            )
        )
    )
    if card is None:
        raise AppException(
            status_code=404,
            message="Flashcard not found",
            detail={"code": "FLASHCARD_NOT_FOUND"},
        )
    return card
