from __future__ import annotations

from datetime import UTC, date, datetime

from app.models import User
from app.services.gamification_service import (
    STREAK_BONUS_EXP,
    add_exp_and_check_level,
    get_level_progress_from_total_exp,
    update_study_streak,
)


def _build_user() -> User:
    return User(
        email="gamification@example.com",
        firebase_uid="uid-gamification",
        password_hash=None,
        display_name="Gamification User",
        level=1,
        exp=0,
        total_exp=0,
        current_streak=0,
        streak=0,
    )


def test_level_progress_uses_progressive_thresholds() -> None:
    assert get_level_progress_from_total_exp(0) == (1, 0, 1000)
    assert get_level_progress_from_total_exp(999) == (1, 999, 1000)
    assert get_level_progress_from_total_exp(1000) == (2, 0, 2000)
    assert get_level_progress_from_total_exp(2999) == (2, 1999, 2000)
    assert get_level_progress_from_total_exp(3000) == (3, 0, 3000)
    assert get_level_progress_from_total_exp(6000) == (4, 0, 4000)


def test_add_exp_updates_total_and_level_progressively() -> None:
    user = _build_user()

    gained = add_exp_and_check_level(user, 3500)

    assert gained == 3500
    assert user.exp == 3500
    assert user.total_exp == 3500
    assert user.level == 3


def test_update_study_streak_does_not_double_count_same_local_day() -> None:
    user = _build_user()
    user.current_streak = 2
    user.streak = 2
    user.last_study_date = date(2026, 4, 20)

    streak_bonus_exp = update_study_streak(
        user,
        now_utc=datetime(2026, 4, 19, 18, 30, tzinfo=UTC),
        is_study_day_completed=True,
        study_date=date(2026, 4, 20),
    )

    assert streak_bonus_exp == 0
    assert user.current_streak == 2
    assert user.streak == 2
    assert user.last_study_date == date(2026, 4, 20)


def test_update_study_streak_increments_on_next_local_day() -> None:
    user = _build_user()
    user.current_streak = 2
    user.streak = 2
    user.last_study_date = date(2026, 4, 20)

    streak_bonus_exp = update_study_streak(
        user,
        now_utc=datetime(2026, 4, 20, 18, 30, tzinfo=UTC),
        is_study_day_completed=True,
        study_date=date(2026, 4, 21),
    )

    assert streak_bonus_exp == STREAK_BONUS_EXP
    assert user.current_streak == 3
    assert user.streak == 3
    assert user.last_study_date == date(2026, 4, 21)
