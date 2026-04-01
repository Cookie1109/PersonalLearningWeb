from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.models import User

LEVEL_EXP_STEP = 1000
STREAK_BONUS_EXP = 20


def _safe_int(value: int | None) -> int:
    return int(value or 0)


def get_total_exp(user: User) -> int:
    # Keep backward compatibility with legacy total_exp while introducing exp as canonical field.
    return max(_safe_int(getattr(user, "exp", 0)), _safe_int(getattr(user, "total_exp", 0)))


def get_current_streak(user: User) -> int:
    return max(_safe_int(getattr(user, "current_streak", 0)), _safe_int(getattr(user, "streak", 0)))


def add_exp_and_check_level(user: User, base_exp: int) -> int:
    if base_exp < 0:
        raise ValueError("base_exp must be non-negative")

    new_total_exp = get_total_exp(user) + base_exp
    user.exp = new_total_exp
    user.total_exp = new_total_exp
    user.level = (new_total_exp // LEVEL_EXP_STEP) + 1
    return base_exp


def update_study_streak(user: User, *, now_utc: datetime | None = None) -> int:
    now = now_utc or datetime.now(UTC)
    today = now.date()
    yesterday = today - timedelta(days=1)

    last_study_date = user.last_study_date
    current_streak = get_current_streak(user)

    if last_study_date == today:
        user.current_streak = current_streak
        user.streak = current_streak
        return 0

    if last_study_date == yesterday:
        current_streak += 1
        streak_bonus_exp = STREAK_BONUS_EXP
    else:
        current_streak = 1
        streak_bonus_exp = 0

    user.current_streak = current_streak
    user.streak = current_streak
    user.last_study_date = today
    return streak_bonus_exp
