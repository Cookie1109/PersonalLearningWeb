from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas import ChatHistoryMessageDTO, ChatRequestDTO, ChatResponseDTO, ErrorResponseDTO
from app.services.chat_service import get_chat_history, process_chat_turn

router = APIRouter(prefix="/chat", tags=["chat"])

ERROR_RESPONSES = {
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


@router.post(
    "",
    response_model=ChatResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def chat(
    payload: ChatRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponseDTO:
    reply = process_chat_turn(
        db=db,
        user_id=current_user.id,
        messages=[message.model_dump() for message in payload.messages],
    )
    return ChatResponseDTO(reply=reply)


@router.get(
    "/history",
    response_model=list[ChatHistoryMessageDTO],
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def chat_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatHistoryMessageDTO]:
    records = get_chat_history(db=db, user_id=current_user.id)
    return [
        ChatHistoryMessageDTO(
            id=record.id,
            role=record.role,
            content=record.content,
            created_at=record.created_at,
        )
        for record in records
    ]
