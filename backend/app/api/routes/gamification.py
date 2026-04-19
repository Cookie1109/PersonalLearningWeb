from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models import DailyQuest, User
from app.schemas import (
    DailyQuestDTO,
    DailyQuestListResponseDTO,
    ErrorResponseDTO,
    GamificationProfileDTO,
    GamificationTrackRequestDTO,
    GamificationTrackResponseDTO,
    QuestProgressUpdateDTO,
)
from app.services.daily_quest_service import (
    get_or_create_daily_quests,
    get_daily_quest_profile_snapshot,
    resolve_daily_quest_date,
    track_gamification_action,
)

router = APIRouter(prefix="/gamification", tags=["gamification"])
settings = get_settings()

ERROR_RESPONSES = {
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
}


def _to_daily_quest_dto(quest: DailyQuest) -> DailyQuestDTO:
    return DailyQuestDTO(
        id=str(quest.id),
        quest_code=quest.quest_code,
        title=quest.title,
        difficulty=quest.difficulty,
        action_type=quest.action_type,
        target_value=quest.target_value,
        current_progress=quest.current_progress,
        is_completed=quest.is_completed,
        exp_reward=quest.exp_reward,
        quest_date=quest.quest_date.isoformat(),
    )


@router.get(
    "/profile",
    response_model=GamificationProfileDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_gamification_profile(
    current_user: User = Depends(get_current_user),
) -> GamificationProfileDTO:
    level, current_exp, target_exp, total_exp, current_streak = get_daily_quest_profile_snapshot(user=current_user)
    return GamificationProfileDTO(
        level=level,
        current_exp=current_exp,
        target_exp=target_exp,
        total_exp=total_exp,
        current_streak=current_streak,
    )


@router.get(
    "/quests",
    response_model=DailyQuestListResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_daily_quests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DailyQuestListResponseDTO:
    quest_date = resolve_daily_quest_date()
    quests = get_or_create_daily_quests(db=db, user_id=current_user.id, quest_date=quest_date)

    return DailyQuestListResponseDTO(
        quest_date=quest_date.isoformat(),
        timezone=settings.daily_quest_reset_timezone,
        all_clear_bonus_exp=settings.daily_quest_all_clear_bonus_exp,
        all_clear_completed=bool(quests) and all(quest.is_completed for quest in quests),
        quests=[_to_daily_quest_dto(quest) for quest in quests],
    )


@router.post(
    "/track",
    response_model=GamificationTrackResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def track_gamification(
    payload: GamificationTrackRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GamificationTrackResponseDTO:
    result = track_gamification_action(
        db=db,
        user_id=current_user.id,
        action_type=payload.action_type,
        target_id=payload.target_id,
        value=payload.value,
    )

    return GamificationTrackResponseDTO(
        accepted=result.accepted,
        action_type=result.action_type,
        target_id=result.target_id,
        value=result.value,
        exp_gained=result.exp_gained,
        completion_exp_gained=result.completion_exp_gained,
        all_clear_awarded=result.all_clear_awarded,
        all_clear_bonus_exp=result.all_clear_bonus_exp,
        blocked_reason=result.blocked_reason,
        quest_updates=[
            QuestProgressUpdateDTO(
                quest_id=update.quest_id,
                quest_code=update.quest_code,
                previous_progress=update.previous_progress,
                current_progress=update.current_progress,
                target_value=update.target_value,
                is_completed=update.is_completed,
                just_completed=update.just_completed,
                completion_exp_awarded=update.completion_exp_awarded,
            )
            for update in result.quest_updates
        ],
        total_exp=result.total_exp,
        level=result.level,
        current_exp=result.current_exp,
        target_exp=result.target_exp,
        current_streak=result.current_streak,
    )
