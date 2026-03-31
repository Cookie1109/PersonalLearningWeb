from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.deps import get_current_user
from app.models import User
from app.schemas import ChatRequestDTO, ChatResponseDTO, ErrorResponseDTO
from app.services.chat_service import generate_chat_reply

router = APIRouter(prefix="/chat", tags=["chat"])

ERROR_RESPONSES = {
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
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
) -> ChatResponseDTO:
    _ = current_user
    reply = generate_chat_reply(messages=[message.model_dump() for message in payload.messages])
    return ChatResponseDTO(reply=reply)
