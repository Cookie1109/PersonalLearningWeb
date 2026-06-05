from __future__ import annotations

from fastapi import APIRouter, Depends, status
from redis import Redis
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List
from datetime import datetime, timezone
from sqlalchemy import select, and_

from app.api.deps import get_current_user, get_owned_flashcard_or_404
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.db.session import get_db
from app.infra.redis_client import get_redis_client
from app.models import Flashcard, User
from app.models.fsrs_graph_models import FSRSCard
from app.schemas import ErrorResponseDTO, FlashcardDTO, FlashcardExplainResponseDTO, FlashcardStatusUpdateRequestDTO
from app.services.flashcard_rate_limit_store import FlashcardExplainRateLimitStore
from app.services.flashcard_service import explain_flashcard_for_user, update_flashcard_status_for_user

router = APIRouter(prefix="/flashcards", tags=["flashcards"])
settings = get_settings()

ERROR_RESPONSES = {
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    404: {"model": ErrorResponseDTO, "description": "Not Found"},
    500: {"model": ErrorResponseDTO, "description": "Internal Server Error"},
    429: {"model": ErrorResponseDTO, "description": "Too Many Requests"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


class FSRSReviewRequestDTO(BaseModel):
    rating: int = Field(..., ge=1, le=4, description="1: Again, 2: Hard, 3: Good, 4: Easy")
    review_duration: int | None = Field(default=None, description="Duration in milliseconds")


class FSRSCardDTO(BaseModel):
    card_id: int
    state: int
    step: int | None
    stability: float | None
    difficulty: float | None
    due: datetime
    last_review: datetime | None


class FSRSCardScheduleDTO(BaseModel):
    card_id: int
    front_text: str
    back_text: str
    due: datetime
    state: int
    stability: float | None
    difficulty: float | None
    lesson_id: int
    lesson_title: str


@router.patch(
    "/{card_id}/status",
    response_model=FlashcardDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def update_flashcard_status(
    payload: FlashcardStatusUpdateRequestDTO,
    card: Flashcard = Depends(get_owned_flashcard_or_404),
    db: Session = Depends(get_db),
) -> FlashcardDTO:
    card = update_flashcard_status_for_user(
        db=db,
        card=card,
        status_value=payload.status,
    )

    return FlashcardDTO(
        id=card.id,
        document_id=card.document_id,
        front_text=card.front_text,
        back_text=card.back_text,
        status=card.status,
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


@router.post(
    "/{card_id}/explain",
    response_model=FlashcardExplainResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def explain_flashcard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis_client: Redis = Depends(get_redis_client),
    card: Flashcard = Depends(get_owned_flashcard_or_404),
) -> FlashcardExplainResponseDTO:
    if settings.flashcard_explain_limit_enabled:
        limiter = FlashcardExplainRateLimitStore(
            redis_client,
            max_requests=settings.flashcard_explain_limit_max_requests,
            window_seconds=settings.flashcard_explain_limit_window_seconds,
        )
        try:
            limiter.enforce_or_raise(user_id=current_user.id)
        except AppException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            if settings.app_env == "dev" and exc.status_code == 503 and detail.get("code") == "REDIS_UNAVAILABLE":
                pass
            else:
                raise

    explanation = explain_flashcard_for_user(
        db=db,
        card=card,
    )

    return FlashcardExplainResponseDTO(explanation=explanation)


@router.get("/review-schedule", response_model=List[FSRSCardScheduleDTO])
def get_review_schedule(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> List[FSRSCardScheduleDTO]:
    """
    Get due flashcards for the current user, with pagination.
    """
    now_utc = datetime.now(timezone.utc)
    stmt = (
        select(FSRSCard)
        .join(Flashcard, FSRSCard.card_id == Flashcard.id)
        .where(
            and_(
                Flashcard.lesson.has(user_id=current_user.id),
                FSRSCard.due <= now_utc
            )
        )
        .order_by(FSRSCard.due.asc())
        .limit(min(limit, 200))
        .offset(offset)
    )
    fsrs_cards = db.scalars(stmt).all()

    dtos = []
    for fc in fsrs_cards:
        card = fc.flashcard
        dtos.append(FSRSCardScheduleDTO(
            card_id=fc.card_id,
            front_text=card.front_text,
            back_text=card.back_text,
            due=fc.due,
            state=fc.state,
            stability=fc.stability,
            difficulty=fc.difficulty,
            lesson_id=card.document_id,
            lesson_title=card.lesson.title
        ))
    return dtos


@router.post("/{card_id}/review", response_model=FSRSCardDTO)
def submit_flashcard_review(
    card_id: int,
    payload: FSRSReviewRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> FSRSCardDTO:
    """
    Submit a review rating (1: Again, 2: Hard, 3: Good, 4: Easy) for a card.
    Updates FSRS intervals and weakness scores.
    """
    from app.services.fsrs_service import review_card as service_review_card
    fsrs_card = service_review_card(
        db=db,
        user_id=current_user.id,
        card_id=card_id,
        rating_val=payload.rating,
        review_duration=payload.review_duration
    )
    db.commit()
    return FSRSCardDTO(
        card_id=fsrs_card.card_id,
        state=fsrs_card.state,
        step=fsrs_card.step,
        stability=fsrs_card.stability,
        difficulty=fsrs_card.difficulty,
        due=fsrs_card.due,
        last_review=fsrs_card.last_review
    )
