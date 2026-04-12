from __future__ import annotations

from fastapi import APIRouter, Depends, status
from redis import Redis
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.db.session import get_db
from app.infra.redis_client import get_redis_client
from app.models import Lesson, User
from app.schemas import (
    DocumentChatRequestDTO,
    DocumentChatResponseDTO,
    DocumentCreateRequestDTO,
    DocumentCreateResponseDTO,
    DocumentDeleteResponseDTO,
    DocumentRenameRequestDTO,
    DocumentQuizSubmitRequestDTO,
    DocumentSummaryDTO,
    ErrorResponseDTO,
    QuizPublicResponseDTO,
    QuizSubmitResponseDTO,
)
from app.services import chat_service
from app.services.lesson_service import (
    create_document_for_user,
    delete_document_for_user,
    list_documents_for_user,
    rename_document_for_user,
)
from app.services.quiz_generation_rate_limit_store import QuizGenerationRateLimitStore
from app.services.quiz_service import (
    ensure_quiz_regeneration_allowed_for_lesson_user,
    generate_quiz_for_lesson_user,
    get_quiz_for_lesson_user,
    submit_quiz_for_lesson_user,
)

router = APIRouter(prefix="/documents", tags=["documents"])
settings = get_settings()

ERROR_RESPONSES = {
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    404: {"model": ErrorResponseDTO, "description": "Not Found"},
    500: {"model": ErrorResponseDTO, "description": "Internal Server Error"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    429: {"model": ErrorResponseDTO, "description": "Too Many Requests"},
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


@router.patch(
    "/{doc_id}",
    response_model=DocumentSummaryDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def rename_document(
    doc_id: int,
    payload: DocumentRenameRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentSummaryDTO:
    return rename_document_for_user(
        db=db,
        user_id=current_user.id,
        lesson_id=doc_id,
        title=payload.title,
    )


@router.delete(
    "/{doc_id}",
    response_model=DocumentDeleteResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def delete_document(
    doc_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentDeleteResponseDTO:
    delete_document_for_user(
        db=db,
        user_id=current_user.id,
        lesson_id=doc_id,
    )
    return DocumentDeleteResponseDTO(document_id=doc_id, message="Document deleted")


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


@router.post(
    "/{document_id}/quiz/generate",
    response_model=QuizPublicResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def generate_document_quiz(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis_client: Redis = Depends(get_redis_client),
) -> QuizPublicResponseDTO:
    ensure_quiz_regeneration_allowed_for_lesson_user(
        db=db,
        user_id=current_user.id,
        lesson_id=document_id,
    )

    if settings.quiz_regeneration_limit_enabled:
        limiter = QuizGenerationRateLimitStore(
            redis_client,
            max_requests=settings.quiz_regeneration_limit_max_requests,
            window_seconds=settings.quiz_regeneration_limit_window_seconds,
        )
        try:
            limiter.enforce_or_raise(user_id=current_user.id, lesson_id=document_id)
        except AppException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            if settings.app_env == "dev" and exc.status_code == 503 and detail.get("code") == "REDIS_UNAVAILABLE":
                pass
            else:
                raise

    return generate_quiz_for_lesson_user(
        db=db,
        user_id=current_user.id,
        lesson_id=document_id,
    )


@router.get(
    "/{document_id}/quiz",
    response_model=QuizPublicResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_document_quiz(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QuizPublicResponseDTO:
    return get_quiz_for_lesson_user(
        db=db,
        user_id=current_user.id,
        lesson_id=document_id,
    )


@router.post(
    "/{document_id}/quiz/submit",
    response_model=QuizSubmitResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def submit_document_quiz(
    document_id: int,
    payload: DocumentQuizSubmitRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QuizSubmitResponseDTO:
    return submit_quiz_for_lesson_user(
        db=db,
        user_id=current_user.id,
        lesson_id=document_id,
        selected_answers=payload.selected_answers,
        pass_score=settings.quiz_pass_score,
        reward_exp=settings.quiz_pass_reward_exp,
        reward_type=settings.quiz_first_pass_reward_type,
    )
