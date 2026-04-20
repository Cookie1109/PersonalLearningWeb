from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.models import DailyQuest, ExpLedger, User
from app.services.gamification_service import (
    add_exp_and_check_level,
    get_current_streak,
    get_level_progress,
    get_total_exp,
    update_study_streak,
)

settings = get_settings()

ACTION_TYPE_READ_DOCUMENT = "READ_DOCUMENT"
ACTION_TYPE_LEARN_FLASHCARD = "LEARN_FLASHCARD"
ACTION_TYPE_QUIZ_COMPLETED = "QUIZ_COMPLETED"
ACTION_TYPE_COMPLETE_DAILY_QUEST = "COMPLETE_DAILY_QUEST"

REWARD_TYPE_GAMIFICATION_TRACK = "gamification_track"
REWARD_TYPE_DAILY_QUEST_COMPLETE = "daily_quest_complete"
REWARD_TYPE_DAILY_QUEST_ALL_CLEAR = "daily_quest_all_clear"

CUMULATIVE_TRACK_ACTION_TYPES = frozenset({ACTION_TYPE_READ_DOCUMENT})


@dataclass(frozen=True)
class QuestTemplate:
    code: str
    title: str
    difficulty: str
    action_type: str
    target_value: int
    exp_reward: int


@dataclass(frozen=True)
class QuestProgressDelta:
    quest_id: str
    quest_code: str
    previous_progress: int
    current_progress: int
    target_value: int
    is_completed: bool
    just_completed: bool
    completion_exp_awarded: int


@dataclass(frozen=True)
class TrackGamificationResult:
    accepted: bool
    action_type: str
    target_id: str
    value: int
    exp_gained: int
    completion_exp_gained: int
    all_clear_awarded: bool
    all_clear_bonus_exp: int
    blocked_reason: str | None
    quest_updates: list[QuestProgressDelta]
    total_exp: int
    level: int
    current_exp: int
    target_exp: int
    current_streak: int


QUEST_TEMPLATES: tuple[QuestTemplate, ...] = (
    QuestTemplate(
        code="READ_5M",
        title="Đọc tài liệu tập trung 5 phút",
        difficulty="medium",
        action_type=ACTION_TYPE_READ_DOCUMENT,
        target_value=5,
        exp_reward=50,
    ),
    QuestTemplate(
        code="COMPLETE_QUIZ",
        title="Hoàn thành 1 bài Quiz",
        difficulty="hard",
        action_type=ACTION_TYPE_QUIZ_COMPLETED,
        target_value=1,
        exp_reward=70,
    ),
)

QUEST_TEMPLATE_BY_CODE: dict[str, QuestTemplate] = {
    template.code: template for template in QUEST_TEMPLATES
}

QUEST_ORDER_BY_CODE: dict[str, int] = {
    template.code: index for index, template in enumerate(QUEST_TEMPLATES)
}

_TRACK_EXP_PER_UNIT_BY_ACTION: dict[str, int] = {
    ACTION_TYPE_READ_DOCUMENT: settings.gamification_track_read_exp_per_unit,
    ACTION_TYPE_LEARN_FLASHCARD: settings.gamification_track_flashcard_exp_per_unit,
    ACTION_TYPE_QUIZ_COMPLETED: 0,
}


def resolve_daily_quest_date(*, now_utc: datetime | None = None, timezone_name: str | None = None) -> date:
    resolved_timezone_name = (timezone_name or settings.daily_quest_reset_timezone or "Asia/Ho_Chi_Minh").strip()

    try:
        timezone = ZoneInfo(resolved_timezone_name)
    except Exception:
        timezone = ZoneInfo("Asia/Ho_Chi_Minh")

    now = now_utc or datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)

    return now.astimezone(timezone).date()


def _quest_sort_key(quest: DailyQuest) -> tuple[int, str]:
    return QUEST_ORDER_BY_CODE.get(quest.quest_code, 99), quest.quest_code


def get_or_create_daily_quests(
    *,
    db: Session,
    user_id: int,
    quest_date: date | None = None,
    rng: object | None = None,
    auto_commit: bool = True,
) -> list[DailyQuest]:
    # Kept for backward compatibility with old callers; quest generation is deterministic now.
    _ = rng

    resolved_date = quest_date or resolve_daily_quest_date()

    existing_quests = list(
        db.scalars(
            select(DailyQuest)
            .where(and_(DailyQuest.user_id == user_id, DailyQuest.quest_date == resolved_date))
            .order_by(DailyQuest.difficulty, DailyQuest.quest_code)
        )
    )

    changed = False
    expected_codes = set(QUEST_TEMPLATE_BY_CODE.keys())

    filtered_existing: list[DailyQuest] = []
    for quest in existing_quests:
        if quest.quest_code in expected_codes:
            filtered_existing.append(quest)
            continue
        db.delete(quest)
        changed = True

    existing_by_code = {quest.quest_code: quest for quest in filtered_existing}

    for template in QUEST_TEMPLATES:
        existing = existing_by_code.get(template.code)
        if existing is None:
            db.add(
                DailyQuest(
                    user_id=user_id,
                    quest_code=template.code,
                    difficulty=template.difficulty,
                    action_type=template.action_type,
                    title=template.title,
                    target_value=template.target_value,
                    current_progress=0,
                    is_completed=False,
                    exp_reward=template.exp_reward,
                    quest_date=resolved_date,
                )
            )
            changed = True
            continue

        if existing.difficulty != template.difficulty:
            existing.difficulty = template.difficulty
            changed = True
        if existing.action_type != template.action_type:
            existing.action_type = template.action_type
            changed = True
        if existing.title != template.title:
            existing.title = template.title
            changed = True
        if int(existing.target_value or 0) != template.target_value:
            existing.target_value = template.target_value
            if int(existing.current_progress or 0) > template.target_value:
                existing.current_progress = template.target_value
            changed = True
        if int(existing.exp_reward or 0) != template.exp_reward:
            existing.exp_reward = template.exp_reward
            changed = True

    if not changed:
        return sorted(existing_quests, key=_quest_sort_key)

    if not auto_commit:
        db.flush()
        refreshed_no_commit = list(
            db.scalars(
                select(DailyQuest)
                .where(and_(DailyQuest.user_id == user_id, DailyQuest.quest_date == resolved_date))
                .order_by(DailyQuest.quest_code)
            )
        )
        return sorted(refreshed_no_commit, key=_quest_sort_key)

    db.commit()

    refreshed = list(
        db.scalars(
            select(DailyQuest)
            .where(and_(DailyQuest.user_id == user_id, DailyQuest.quest_date == resolved_date))
            .order_by(DailyQuest.quest_code)
        )
    )
    return sorted(refreshed, key=_quest_sort_key)


def _build_quest_completion_target_id(*, quest_date: date, quest_code: str) -> str:
    return f"{quest_date.isoformat()}:{quest_code}"


def _build_all_clear_target_id(*, quest_date: date) -> str:
    return f"{quest_date.isoformat()}:ALL_CLEAR"


def _find_existing_reward(
    *,
    db: Session,
    user_id: int,
    action_type: str,
    target_id: str,
    reward_type: str,
) -> int | None:
    return db.scalar(
        select(ExpLedger.id).where(
            and_(
                ExpLedger.user_id == user_id,
                ExpLedger.action_type == action_type,
                ExpLedger.target_id == target_id,
                ExpLedger.reward_type == reward_type,
            )
        )
    )


def _append_reward_entry(
    *,
    db: Session,
    user_id: int,
    action_type: str,
    target_id: str,
    reward_type: str,
    exp_amount: int,
    metadata_json: dict[str, object] | None,
) -> None:
    db.add(
        ExpLedger(
            user_id=user_id,
            lesson_id=None,
            quiz_id=None,
            action_type=action_type,
            target_id=target_id,
            reward_type=reward_type,
            exp_amount=exp_amount,
            metadata_json=metadata_json,
        )
    )


def _build_track_reward_target_id(*, action_type: str, target_id: str) -> str:
    if action_type not in CUMULATIVE_TRACK_ACTION_TYPES:
        return target_id

    suffix = uuid4().hex[:12]
    max_prefix_length = max(1, 128 - len(suffix) - 1)
    return f"{target_id[:max_prefix_length]}:{suffix}"


def get_daily_quest_profile_snapshot(*, user: User) -> tuple[int, int, int, int, int]:
    total_exp = get_total_exp(user)
    level, current_exp, target_exp = get_level_progress(user)
    current_streak = get_current_streak(user)
    return level, current_exp, target_exp, total_exp, current_streak


def track_gamification_action(
    *,
    db: Session,
    user_id: int,
    action_type: str,
    target_id: str,
    value: int,
    now_utc: datetime | None = None,
) -> TrackGamificationResult:
    normalized_action_type = (action_type or "").strip().upper()
    normalized_target_id = (target_id or "").strip()

    if normalized_action_type not in _TRACK_EXP_PER_UNIT_BY_ACTION:
        raise AppException(
            status_code=400,
            message="Action type is invalid",
            detail={"code": "GAMIFICATION_ACTION_TYPE_INVALID"},
        )

    if not normalized_target_id:
        raise AppException(
            status_code=400,
            message="target_id is required",
            detail={"code": "GAMIFICATION_TARGET_REQUIRED"},
        )

    if len(normalized_target_id) > 128:
        raise AppException(
            status_code=400,
            message="target_id is too long",
            detail={"code": "GAMIFICATION_TARGET_TOO_LONG"},
        )

    if value <= 0:
        raise AppException(
            status_code=400,
            message="value must be greater than 0",
            detail={"code": "GAMIFICATION_VALUE_INVALID"},
        )

    if value > 1000:
        raise AppException(
            status_code=400,
            message="value is too large",
            detail={"code": "GAMIFICATION_VALUE_TOO_LARGE"},
        )

    locked_user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if locked_user is None:
        raise AppException(status_code=401, message="User not found", detail={"code": "USER_NOT_FOUND"})

    quest_date = resolve_daily_quest_date(now_utc=now_utc)
    quests = get_or_create_daily_quests(db=db, user_id=user_id, quest_date=quest_date, auto_commit=False)

    if normalized_action_type not in CUMULATIVE_TRACK_ACTION_TYPES:
        existing_track_reward = _find_existing_reward(
            db=db,
            user_id=user_id,
            action_type=normalized_action_type,
            target_id=normalized_target_id,
            reward_type=REWARD_TYPE_GAMIFICATION_TRACK,
        )
        if existing_track_reward is not None:
            level, current_exp, target_exp, total_exp, current_streak = get_daily_quest_profile_snapshot(user=locked_user)
            return TrackGamificationResult(
                accepted=False,
                action_type=normalized_action_type,
                target_id=normalized_target_id,
                value=value,
                exp_gained=0,
                completion_exp_gained=0,
                all_clear_awarded=False,
                all_clear_bonus_exp=0,
                blocked_reason="DUPLICATE_TARGET",
                quest_updates=[],
                total_exp=total_exp,
                level=level,
                current_exp=current_exp,
                target_exp=target_exp,
                current_streak=current_streak,
            )

    base_exp_per_unit = _TRACK_EXP_PER_UNIT_BY_ACTION[normalized_action_type]
    track_exp_gained = add_exp_and_check_level(locked_user, base_exp_per_unit * value)
    track_reward_target_id = _build_track_reward_target_id(
        action_type=normalized_action_type,
        target_id=normalized_target_id,
    )
    _append_reward_entry(
        db=db,
        user_id=user_id,
        action_type=normalized_action_type,
        target_id=track_reward_target_id,
        reward_type=REWARD_TYPE_GAMIFICATION_TRACK,
        exp_amount=track_exp_gained,
        metadata_json={
            "source": REWARD_TYPE_GAMIFICATION_TRACK,
            "value": value,
            "quest_date": quest_date.isoformat(),
            "raw_target_id": normalized_target_id,
        },
    )

    completion_exp_gained = 0
    quest_updates: list[QuestProgressDelta] = []

    for quest in quests:
        if quest.action_type != normalized_action_type:
            continue

        previous_progress = int(quest.current_progress or 0)
        if quest.is_completed:
            quest_updates.append(
                QuestProgressDelta(
                    quest_id=str(quest.id),
                    quest_code=quest.quest_code,
                    previous_progress=previous_progress,
                    current_progress=previous_progress,
                    target_value=quest.target_value,
                    is_completed=True,
                    just_completed=False,
                    completion_exp_awarded=0,
                )
            )
            continue

        next_progress = min(quest.target_value, previous_progress + value)
        quest.current_progress = next_progress

        just_completed = next_progress >= quest.target_value
        completion_exp_awarded = 0

        if just_completed:
            quest.is_completed = True
            quest.completed_at = now_utc or datetime.now(UTC)

            completion_target_id = _build_quest_completion_target_id(quest_date=quest.quest_date, quest_code=quest.quest_code)
            existing_completion_reward = _find_existing_reward(
                db=db,
                user_id=user_id,
                action_type=ACTION_TYPE_COMPLETE_DAILY_QUEST,
                target_id=completion_target_id,
                reward_type=REWARD_TYPE_DAILY_QUEST_COMPLETE,
            )
            if existing_completion_reward is None:
                completion_exp_awarded = add_exp_and_check_level(locked_user, quest.exp_reward)
                completion_exp_gained += completion_exp_awarded
                _append_reward_entry(
                    db=db,
                    user_id=user_id,
                    action_type=ACTION_TYPE_COMPLETE_DAILY_QUEST,
                    target_id=completion_target_id,
                    reward_type=REWARD_TYPE_DAILY_QUEST_COMPLETE,
                    exp_amount=completion_exp_awarded,
                    metadata_json={
                        "source": REWARD_TYPE_DAILY_QUEST_COMPLETE,
                        "quest_code": quest.quest_code,
                        "quest_date": quest.quest_date.isoformat(),
                    },
                )

        quest_updates.append(
            QuestProgressDelta(
                quest_id=str(quest.id),
                quest_code=quest.quest_code,
                previous_progress=previous_progress,
                current_progress=next_progress,
                target_value=quest.target_value,
                is_completed=quest.is_completed,
                just_completed=just_completed,
                completion_exp_awarded=completion_exp_awarded,
            )
        )

    all_clear_awarded = False
    all_clear_bonus_exp = 0
    has_any_completed_quest = bool(quests) and any(quest.is_completed for quest in quests)
    if has_any_completed_quest:
        update_study_streak(
            locked_user,
            now_utc=now_utc,
            is_study_day_completed=True,
            study_date=quest_date,
        )

    if quests and all(quest.is_completed for quest in quests):

        all_clear_target_id = _build_all_clear_target_id(quest_date=quest_date)
        existing_all_clear_reward = _find_existing_reward(
            db=db,
            user_id=user_id,
            action_type=ACTION_TYPE_COMPLETE_DAILY_QUEST,
            target_id=all_clear_target_id,
            reward_type=REWARD_TYPE_DAILY_QUEST_ALL_CLEAR,
        )
        if existing_all_clear_reward is None:
            all_clear_bonus_exp = max(0, int(settings.daily_quest_all_clear_bonus_exp or 0))
            if all_clear_bonus_exp > 0:
                add_exp_and_check_level(locked_user, all_clear_bonus_exp)
            _append_reward_entry(
                db=db,
                user_id=user_id,
                action_type=ACTION_TYPE_COMPLETE_DAILY_QUEST,
                target_id=all_clear_target_id,
                reward_type=REWARD_TYPE_DAILY_QUEST_ALL_CLEAR,
                exp_amount=all_clear_bonus_exp,
                metadata_json={
                    "source": REWARD_TYPE_DAILY_QUEST_ALL_CLEAR,
                    "quest_date": quest_date.isoformat(),
                },
            )
            all_clear_awarded = True

    db.commit()
    db.refresh(locked_user)

    level, current_exp, target_exp, total_exp, current_streak = get_daily_quest_profile_snapshot(user=locked_user)

    return TrackGamificationResult(
        accepted=True,
        action_type=normalized_action_type,
        target_id=normalized_target_id,
        value=value,
        exp_gained=track_exp_gained,
        completion_exp_gained=completion_exp_gained,
        all_clear_awarded=all_clear_awarded,
        all_clear_bonus_exp=all_clear_bonus_exp,
        blocked_reason=None,
        quest_updates=quest_updates,
        total_exp=total_exp,
        level=level,
        current_exp=current_exp,
        target_exp=target_exp,
        current_streak=current_streak,
    )
