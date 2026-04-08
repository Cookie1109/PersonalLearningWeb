from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas import (
    DocumentCreateRequestDTO,
    DocumentCreateResponseDTO,
    DocumentSummaryDTO,
    ErrorResponseDTO,
)
from app.services.lesson_service import create_document_for_user, list_documents_for_user

router = APIRouter(prefix="/documents", tags=["documents"])

ERROR_RESPONSES = {
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
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
