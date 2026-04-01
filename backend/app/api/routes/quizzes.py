from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Request, status
from redis import Redis
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.infra.redis_client import get_redis_client
from app.models import User
from app.schemas import ErrorResponseDTO, QuizSubmitRequestDTO, QuizSubmitResponseDTO
from app.services.audit_service import queue_audit_log
from app.services.quiz_cooldown_store import QuizCooldownStore
from app.services.quiz_service import submit_quiz_for_user

router = APIRouter(prefix="/quizzes", tags=["quizzes"])
settings = get_settings()

ERROR_RESPONSES = {
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    404: {"model": ErrorResponseDTO, "description": "Quiz Not Found"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    429: {"model": ErrorResponseDTO, "description": "Too Many Requests"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


@router.post(
    "/{quiz_id}/submit",
    response_model=QuizSubmitResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def submit_quiz(
    quiz_id: str,
    payload: QuizSubmitRequestDTO,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis_client: Redis = Depends(get_redis_client),
) -> QuizSubmitResponseDTO:
    cooldown_store = QuizCooldownStore(
        redis_client,
        fail_4_5_seconds=settings.quiz_cooldown_fail_4_5_seconds,
        fail_6_plus_seconds=settings.quiz_cooldown_fail_6_plus_seconds,
        state_ttl_seconds=settings.quiz_cooldown_state_ttl_seconds,
    )

    cooldown_store.enforce_or_raise(user_id=current_user.id, quiz_id=quiz_id)

    result = submit_quiz_for_user(
        db=db,
        user_id=current_user.id,
        quiz_id=quiz_id,
        answers=payload.answers,
        pass_score=settings.quiz_pass_score,
        reward_exp=settings.quiz_pass_reward_exp,
        reward_type=settings.quiz_first_pass_reward_type,
    )

    if result.is_passed:
        cooldown_store.reset(user_id=current_user.id, quiz_id=quiz_id)
    else:
        cooldown_store.register_failure(user_id=current_user.id, quiz_id=quiz_id)

    queue_audit_log(
        background_tasks,
        user_id=current_user.id,
        action="QUIZ_SUBMITTED",
        resource_id=quiz_id,
        details={
            "score": result.score,
            "is_passed": result.is_passed,
            "exp_gained": result.exp_gained,
            "reward_granted": result.reward_granted,
            "total_exp": result.total_exp,
            "level": result.level,
            "wrong_question_count": len([item for item in result.results if not item.is_correct]),
            "request_id": getattr(request.state, "request_id", None),
        },
    )

    return result
