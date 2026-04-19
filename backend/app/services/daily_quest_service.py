from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
import random
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
)

settings = get_settings()

ACTION_TYPE_READ_DOCUMENT = "READ_DOCUMENT"
ACTION_TYPE_LEARN_FLASHCARD = "LEARN_FLASHCARD"
ACTION_TYPE_SUMMARY_CREATED = "SUMMARY_CREATED"
ACTION_TYPE_COMPLETE_DAILY_QUEST = "COMPLETE_DAILY_QUEST"

REWARD_TYPE_GAMIFICATION_TRACK = "gamification_track"
REWARD_TYPE_DAILY_QUEST_COMPLETE = "daily_quest_complete"
REWARD_TYPE_DAILY_QUEST_ALL_CLEAR = "daily_quest_all_clear"


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


QUEST_POOL_BY_DIFFICULTY: dict[str, tuple[QuestTemplate, ...]] = {
    "easy": (
        QuestTemplate(
            code="SUMMARY_1",
            title="Tóm tắt 1 tài liệu mới bằng AI",
            difficulty="easy",
            action_type=ACTION_TYPE_SUMMARY_CREATED,
            target_value=1,
            exp_reward=30,
        ),
        QuestTemplate(
            code="CARDS_5",
            title="Ôn tập 5 thẻ Flashcard",
            difficulty="easy",
            action_type=ACTION_TYPE_LEARN_FLASHCARD,
            target_value=5,
            exp_reward=20,
        ),
    ),
    "medium": (
        QuestTemplate(
            code="CARDS_10",
            title="Đánh dấu 10 thẻ đã thuộc",
            difficulty="medium",
            action_type=ACTION_TYPE_LEARN_FLASHCARD,
            target_value=10,
            exp_reward=40,
        ),
        QuestTemplate(
            code="READ_10M",
            title="Đọc tài liệu tập trung 10 phút",
            difficulty="medium",
            action_type=ACTION_TYPE_READ_DOCUMENT,
            target_value=10,
            exp_reward=50,
        ),
    ),
    "hard": (
        QuestTemplate(
            code="SUMMARY_2",
            title="Tạo 2 bản tóm tắt tài liệu",
            difficulty="hard",
            action_type=ACTION_TYPE_SUMMARY_CREATED,
            target_value=2,
            exp_reward=60,
        ),
        QuestTemplate(
            code="READ_20M",
            title="Đọc tài liệu tập trung 20 phút",
            difficulty="hard",
            action_type=ACTION_TYPE_READ_DOCUMENT,
            target_value=20,
            exp_reward=100,
        ),
    ),
}

_TRACK_EXP_PER_UNIT_BY_ACTION: dict[str, int] = {
    ACTION_TYPE_READ_DOCUMENT: settings.gamification_track_read_exp_per_unit,
    ACTION_TYPE_LEARN_FLASHCARD: settings.gamification_track_flashcard_exp_per_unit,
    ACTION_TYPE_SUMMARY_CREATED: settings.gamification_track_summary_exp_per_unit,
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
    order = {"easy": 0, "medium": 1, "hard": 2}
    return order.get(quest.difficulty, 99), quest.quest_code


def _pick_template_for_difficulty(
    *,
    difficulty: str,
    excluded_codes: set[str],
    rng: random.Random | None = None,
) -> QuestTemplate:
    candidates = [template for template in QUEST_POOL_BY_DIFFICULTY[difficulty] if template.code not in excluded_codes]
    if not candidates:
        candidates = list(QUEST_POOL_BY_DIFFICULTY[difficulty])

    chooser = rng.choice if rng is not None else random.choice
    return chooser(candidates)


def get_or_create_daily_quests(
    *,
    db: Session,
    user_id: int,
    quest_date: date | None = None,
    rng: random.Random | None = None,
    auto_commit: bool = True,
) -> list[DailyQuest]:
    resolved_date = quest_date or resolve_daily_quest_date()

    existing_quests = list(
        db.scalars(
            select(DailyQuest)
            .where(and_(DailyQuest.user_id == user_id, DailyQuest.quest_date == resolved_date))
            .order_by(DailyQuest.difficulty, DailyQuest.quest_code)
        )
    )

    if len(existing_quests) >= 3:
        return sorted(existing_quests, key=_quest_sort_key)

    existing_codes = {quest.quest_code for quest in existing_quests}
    existing_difficulties = {quest.difficulty for quest in existing_quests}

    created_any = False

    for difficulty in ("easy", "medium", "hard"):
        if difficulty in existing_difficulties:
            continue

        template = _pick_template_for_difficulty(difficulty=difficulty, excluded_codes=existing_codes, rng=rng)
        new_quest = DailyQuest(
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
        db.add(new_quest)
        existing_quests.append(new_quest)
        existing_codes.add(template.code)
        created_any = True

    if not created_any:
        return sorted(existing_quests, key=_quest_sort_key)

    if not auto_commit:
        db.flush()
        return sorted(existing_quests, key=_quest_sort_key)

    db.commit()

    refreshed = list(
        db.scalars(
            select(DailyQuest)
            .where(and_(DailyQuest.user_id == user_id, DailyQuest.quest_date == resolved_date))
            .order_by(DailyQuest.difficulty, DailyQuest.quest_code)
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
    _append_reward_entry(
        db=db,
        user_id=user_id,
        action_type=normalized_action_type,
        target_id=normalized_target_id,
        reward_type=REWARD_TYPE_GAMIFICATION_TRACK,
        exp_amount=track_exp_gained,
        metadata_json={
            "source": REWARD_TYPE_GAMIFICATION_TRACK,
            "value": value,
            "quest_date": quest_date.isoformat(),
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
