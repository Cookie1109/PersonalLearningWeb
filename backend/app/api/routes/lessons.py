from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request, status
from redis import Redis
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.db.session import get_db
from app.infra.redis_client import get_redis_client
from app.models import User
from app.schemas import (
    ErrorResponseDTO,
    FlashcardCompleteResponseDTO,
    LessonCompleteResponseDTO,
    LessonDetailDTO,
    LessonGenerateResponseDTO,
    QuizPublicResponseDTO,
)
from app.services.audit_service import queue_audit_log
from app.services.idempotency_store import IdempotencyStore
from app.services.lesson_service import (
    complete_lesson_for_user,
    generate_lesson_content_for_user,
    get_lesson_detail_for_user,
    mark_flashcard_completed_for_user,
)
from app.services.quiz_generation_rate_limit_store import QuizGenerationRateLimitStore
from app.services.quiz_service import (
    ensure_quiz_regeneration_allowed_for_lesson_user,
    generate_quiz_for_lesson_user,
    get_quiz_for_lesson_user,
)

router = APIRouter(prefix="/lessons", tags=["lessons"])
settings = get_settings()

ERROR_RESPONSES = {
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    404: {"model": ErrorResponseDTO, "description": "Lesson Not Found"},
    500: {"model": ErrorResponseDTO, "description": "Internal Server Error"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    429: {"model": ErrorResponseDTO, "description": "Too Many Requests"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


@router.get(
    "/{lesson_id}",
    response_model=LessonDetailDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_lesson_detail(
    lesson_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LessonDetailDTO:
    return get_lesson_detail_for_user(db=db, user_id=current_user.id, lesson_id=lesson_id)


@router.post(
    "/{lesson_id}/generate",
    response_model=LessonGenerateResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def generate_lesson(
    lesson_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LessonGenerateResponseDTO:
    lesson = generate_lesson_content_for_user(db=db, user_id=current_user.id, lesson_id=lesson_id)
    return LessonGenerateResponseDTO(lesson=lesson)


@router.post(
    "/{lesson_id}/quiz/generate",
    response_model=QuizPublicResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def generate_lesson_quiz(
    lesson_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis_client: Redis = Depends(get_redis_client),
) -> QuizPublicResponseDTO:
    ensure_quiz_regeneration_allowed_for_lesson_user(
        db=db,
        user_id=current_user.id,
        lesson_id=lesson_id,
    )

    if settings.quiz_regeneration_limit_enabled:
        limiter = QuizGenerationRateLimitStore(
            redis_client,
            max_requests=settings.quiz_regeneration_limit_max_requests,
            window_seconds=settings.quiz_regeneration_limit_window_seconds,
        )
        try:
            limiter.enforce_or_raise(user_id=current_user.id, lesson_id=lesson_id)
        except AppException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            if settings.app_env == "dev" and exc.status_code == 503 and detail.get("code") == "REDIS_UNAVAILABLE":
                pass
            else:
                raise

    return generate_quiz_for_lesson_user(db=db, user_id=current_user.id, lesson_id=lesson_id)


@router.get(
    "/{lesson_id}/quiz",
    response_model=QuizPublicResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_lesson_quiz(
    lesson_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QuizPublicResponseDTO:
    return get_quiz_for_lesson_user(db=db, user_id=current_user.id, lesson_id=lesson_id)


@router.post(
    "/{lesson_id}/flashcards/complete",
    response_model=FlashcardCompleteResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def complete_flashcards(
    lesson_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FlashcardCompleteResponseDTO:
    return mark_flashcard_completed_for_user(db=db, user_id=current_user.id, lesson_id=lesson_id)


@router.post(
    "/{lesson_id}/complete",
    response_model=LessonCompleteResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def complete_lesson(
    lesson_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=8, max_length=128),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis_client: Redis = Depends(get_redis_client),
) -> LessonCompleteResponseDTO:
    idempotency_store = IdempotencyStore(redis_client, ttl_seconds=settings.idempotency_ttl_seconds)
    redis_key = idempotency_store.build_lesson_complete_key(
        user_id=current_user.id,
        lesson_id=lesson_id,
        idempotency_key=idempotency_key,
    )

    state, payload = idempotency_store.begin(redis_key)
    if state == "completed" and payload is not None:
        queue_audit_log(
            background_tasks,
            user_id=current_user.id,
            action="LESSON_COMPLETED",
            resource_id=str(lesson_id),
            details={
                "already_completed": payload.get("already_completed", True),
                "exp_gained": payload.get("exp_gained", 0),
                "streak_bonus_exp": payload.get("streak_bonus_exp", 0),
                "request_id": getattr(request.state, "request_id", None),
                "idempotency_replay": True,
            },
        )
        return LessonCompleteResponseDTO(**payload)

    if state == "in_progress":
        raise AppException(
            status_code=409,
            message="Duplicate request is still processing",
            detail={"code": "IDEMPOTENCY_IN_PROGRESS"},
        )

    try:
        result = complete_lesson_for_user(
            db=db,
            user_id=current_user.id,
            lesson_id=lesson_id,
            reward_exp=settings.lesson_complete_reward_exp,
        )
    except Exception:
        idempotency_store.release(redis_key)
        raise

    idempotency_store.complete(redis_key, result.model_dump())

    queue_audit_log(
        background_tasks,
        user_id=current_user.id,
        action="LESSON_COMPLETED",
        resource_id=str(lesson_id),
        details={
            "already_completed": result.already_completed,
            "exp_gained": result.exp_gained,
            "streak_bonus_exp": result.streak_bonus_exp,
            "request_id": getattr(request.state, "request_id", None),
            "idempotency_replay": False,
        },
    )

    return result
