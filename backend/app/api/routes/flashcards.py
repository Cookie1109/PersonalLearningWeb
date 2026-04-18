from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas import ErrorResponseDTO, FlashcardDTO, FlashcardExplainResponseDTO, FlashcardStatusUpdateRequestDTO
from app.services.flashcard_service import explain_flashcard_for_user, update_flashcard_status_for_user

router = APIRouter(prefix="/flashcards", tags=["flashcards"])

ERROR_RESPONSES = {
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    404: {"model": ErrorResponseDTO, "description": "Not Found"},
    500: {"model": ErrorResponseDTO, "description": "Internal Server Error"},
}


@router.patch(
    "/{card_id}/status",
    response_model=FlashcardDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def update_flashcard_status(
    card_id: int,
    payload: FlashcardStatusUpdateRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FlashcardDTO:
    card = update_flashcard_status_for_user(
        db=db,
        user_id=current_user.id,
        card_id=card_id,
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
    card_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FlashcardExplainResponseDTO:
    explanation = explain_flashcard_for_user(
        db=db,
        user_id=current_user.id,
        card_id=card_id,
    )

    return FlashcardExplainResponseDTO(explanation=explanation)
