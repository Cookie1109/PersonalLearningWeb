from __future__ import annotations

from fastapi import APIRouter, Depends, Header, status
from redis import Redis
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.db.session import get_db
from app.infra.redis_client import get_redis_client
from app.models import User
from app.schemas import ErrorResponseDTO, LessonCompleteResponseDTO
from app.services.idempotency_store import IdempotencyStore
from app.services.lesson_service import complete_lesson_for_user

router = APIRouter(prefix="/lessons", tags=["lessons"])
settings = get_settings()

ERROR_RESPONSES = {
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    404: {"model": ErrorResponseDTO, "description": "Lesson Not Found"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    429: {"model": ErrorResponseDTO, "description": "Too Many Requests"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


@router.post(
    "/{lesson_id}/complete",
    response_model=LessonCompleteResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def complete_lesson(
    lesson_id: int,
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
    return result
