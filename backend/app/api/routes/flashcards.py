from __future__ import annotations

from fastapi import APIRouter, Depends, status
from redis import Redis
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_owned_flashcard_or_404
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.db.session import get_db
from app.infra.redis_client import get_redis_client
from app.models import Flashcard, User
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
