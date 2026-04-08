from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.exceptions import AppException
from app.db.session import get_db
from app.models import Lesson, User
from app.schemas import (
    DocumentChatRequestDTO,
    DocumentChatResponseDTO,
    DocumentCreateRequestDTO,
    DocumentCreateResponseDTO,
    DocumentSummaryDTO,
    ErrorResponseDTO,
)
from app.services import chat_service
from app.services.lesson_service import create_document_for_user, list_documents_for_user

router = APIRouter(prefix="/documents", tags=["documents"])

ERROR_RESPONSES = {
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    404: {"model": ErrorResponseDTO, "description": "Not Found"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


@router.post(
    "",
    response_model=DocumentCreateResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def create_document(
    payload: DocumentCreateRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentCreateResponseDTO:
    lesson = create_document_for_user(
        db=db,
        user_id=current_user.id,
        title=payload.title,
        source_content=payload.source_content,
    )

    return DocumentCreateResponseDTO(
        document_id=lesson.id,
        title=lesson.title,
        message="Document created",
    )


@router.get(
    "",
    response_model=list[DocumentSummaryDTO],
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_my_documents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DocumentSummaryDTO]:
    return list_documents_for_user(db=db, user_id=current_user.id)


@router.post(
    "/{document_id}/chat",
    response_model=DocumentChatResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def chat_with_document(
    document_id: int,
    payload: DocumentChatRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentChatResponseDTO:
    lesson = db.scalar(
        select(Lesson).where(
            and_(
                Lesson.id == document_id,
                Lesson.user_id == current_user.id,
            )
        )
    )
    if lesson is None:
        raise AppException(
            status_code=404,
            message="Document not found",
            detail={"code": "DOCUMENT_NOT_FOUND"},
        )

    reply = chat_service.generate_document_chat_reply(
        source_content=lesson.source_content,
        message=payload.message,
        history=[item.model_dump() for item in payload.history],
    )
    return DocumentChatResponseDTO(reply=reply)
