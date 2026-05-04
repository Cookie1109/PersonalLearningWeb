from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
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
    TutorAskRequestDTO,
    TutorStreamChunkDTO,
    DocumentCreateRequestDTO,
    DocumentCreateResponseDTO,
    DocumentDeleteResponseDTO,
    DocumentPageDTO,
    DocumentRenameRequestDTO,
    DocumentUploadResponseDTO,
    DocumentQuizSubmitRequestDTO,
    DocumentSummaryDTO,
    ErrorResponseDTO,
    FlashcardDTO,
    QuizPublicResponseDTO,
    QuizSubmitResponseDTO,
)
from app.services import ai_tutor_service, chat_service
from app.services.flashcard_service import generate_flashcards_for_document_user, get_flashcards_for_document_user
from app.services.lesson_service import (
    create_document_for_user,
    create_document_from_uploaded_file_for_user,
    delete_document_for_user,
    get_lesson_for_user,
    list_documents_page_for_user,
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
MAX_RAW_TEXT_CHARS = 45000
RAW_TEXT_TOO_LONG_DETAIL_MESSAGE = (
    "Văn bản quá dài (vượt quá 45.000 ký tự). "
    "Vui lòng cắt nhỏ nội dung theo từng chương để AI xử lý chính xác nhất."
)

ERROR_RESPONSES = {
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    404: {"model": ErrorResponseDTO, "description": "Not Found"},
    413: {"model": ErrorResponseDTO, "description": "Payload Too Large"},
    500: {"model": ErrorResponseDTO, "description": "Internal Server Error"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    429: {"model": ErrorResponseDTO, "description": "Too Many Requests"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}

TUTOR_STREAM_RESPONSES = {
    **ERROR_RESPONSES,
    200: {
        "description": "AI Tutor stream (SSE)",
        "content": {"text/event-stream": {"schema": TutorStreamChunkDTO.model_json_schema()}},
    },
}


def _normalize_body_document_id(value: int | str) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            raise AppException(
                status_code=400,
                message="document_id is required",
                detail={"code": "DOCUMENT_ID_REQUIRED"},
            )
        if normalized.isdigit():
            return int(normalized)
    raise AppException(
        status_code=400,
        message="document_id must be a number",
        detail={"code": "DOCUMENT_ID_INVALID"},
    )


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
    normalized_source_content = (payload.source_content or "").strip()
    if len(normalized_source_content) > MAX_RAW_TEXT_CHARS:
        raise HTTPException(status_code=400, detail=RAW_TEXT_TOO_LONG_DETAIL_MESSAGE)

    lesson = create_document_for_user(
        db=db,
        user_id=current_user.id,
        title=payload.title,
        source_content=normalized_source_content,
    )

    return DocumentCreateResponseDTO(
        document_id=lesson.id,
        title=lesson.title,
        message="Document created",
    )


@router.post(
    "/upload",
    response_model=DocumentUploadResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
async def create_document_from_upload(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentUploadResponseDTO:
    try:
        file_bytes = await file.read()
    finally:
        await file.close()

    lesson = create_document_from_uploaded_file_for_user(
        db=db,
        user_id=current_user.id,
        file_name=file.filename,
        content_type=file.content_type,
        file_bytes=file_bytes,
        title_override=title,
    )

    return DocumentUploadResponseDTO(
        document_id=lesson.id,
        title=lesson.title,
        message="Workspace created from upload",
        source_file_url=lesson.source_file_url,
        source_file_name=lesson.source_file_name,
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


@router.get(
    "/paged",
    response_model=DocumentPageDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_my_documents_paged(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=9, ge=1, le=50),
    search: str | None = Query(default=None, max_length=255),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentPageDTO:
    return list_documents_page_for_user(
        db=db,
        user_id=current_user.id,
        page=page,
        page_size=page_size,
        search=search,
    )


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
    "/{document_id}/tutor/stream",
    status_code=status.HTTP_200_OK,
    responses=TUTOR_STREAM_RESPONSES,
)
async def stream_ai_tutor_reply(
    document_id: int,
    payload: TutorAskRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    body_document_id = _normalize_body_document_id(payload.document_id)
    if body_document_id != document_id:
        raise AppException(
            status_code=400,
            message="document_id does not match path parameter",
            detail={"code": "DOCUMENT_ID_MISMATCH"},
        )

    lesson, _ = get_lesson_for_user(db=db, user_id=current_user.id, lesson_id=document_id)
    stream = ai_tutor_service.stream_tutor_answer(
        source_content=lesson.source_content,
        question=payload.question,
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/{document_id}/flashcards/generate",
    response_model=list[FlashcardDTO],
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def generate_document_flashcards(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[FlashcardDTO]:
    cards = generate_flashcards_for_document_user(
        db=db,
        user_id=current_user.id,
        document_id=document_id,
    )
    return [
        FlashcardDTO(
            id=card.id,
            document_id=card.document_id,
            front_text=card.front_text,
            back_text=card.back_text,
            status=card.status,
            created_at=card.created_at,
            updated_at=card.updated_at,
        )
        for card in cards
    ]


@router.get(
    "/{document_id}/flashcards",
    response_model=list[FlashcardDTO],
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_document_flashcards(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[FlashcardDTO]:
    cards = get_flashcards_for_document_user(
        db=db,
        user_id=current_user.id,
        document_id=document_id,
    )
    return [
        FlashcardDTO(
            id=card.id,
            document_id=card.document_id,
            front_text=card.front_text,
            back_text=card.back_text,
            status=card.status,
            created_at=card.created_at,
            updated_at=card.updated_at,
        )
        for card in cards
    ]


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
