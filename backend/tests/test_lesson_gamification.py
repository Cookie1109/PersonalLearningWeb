from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models import Lesson, Roadmap, User


def _seed_lesson(db_session: Session, *, user_id: int, title: str = "Lesson") -> Lesson:
    roadmap = Roadmap(
        user_id=user_id,
        goal="Master a topic",
        title="Learning Roadmap",
        is_active=True,
    )
    db_session.add(roadmap)
    db_session.commit()
    db_session.refresh(roadmap)

    lesson = Lesson(
        roadmap_id=roadmap.id,
        week_number=1,
        position=1,
        title=title,
        is_completed=False,
    )
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)
    return lesson


def _complete_headers(headers: dict[str, str], suffix: str) -> dict[str, str]:
    return {
        **headers,
        "Idempotency-Key": f"idem-{suffix}-12345678",
    }


def test_complete_lesson_first_day_awards_base_exp_without_streak_bonus(
    client,
    db_session: Session,
    auth_headers,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="First Lesson")

    response = client.post(
        f"/api/lessons/{lesson.id}/complete",
        json={},
        headers=_complete_headers(headers, "first-day"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["exp_gained"] == 50
    assert payload["streak_bonus_exp"] == 0
    assert payload["total_exp"] == 50
    assert payload["level"] == 1
    assert payload["current_streak"] == 1
    assert payload["already_completed"] is False

    user_after = db_session.get(User, user.id)
    assert user_after is not None
    assert user_after.exp == 50
    assert user_after.total_exp == 50
    assert user_after.current_streak == 1
    assert user_after.last_study_date == datetime.now(UTC).date()


def test_complete_lesson_consecutive_day_adds_streak_bonus_and_levels_up(
    client,
    db_session: Session,
    auth_headers,
) -> None:
    user, headers = auth_headers

    user.exp = 980
    user.total_exp = 980
    user.level = 1
    user.current_streak = 3
    user.streak = 3
    user.last_study_date = datetime.now(UTC).date() - timedelta(days=1)
    db_session.commit()

    lesson = _seed_lesson(db_session, user_id=user.id, title="Consecutive Lesson")

    response = client.post(
        f"/api/lessons/{lesson.id}/complete",
        json={},
        headers=_complete_headers(headers, "consecutive"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["exp_gained"] == 50
    assert payload["streak_bonus_exp"] == 20
    assert payload["total_exp"] == 1050
    assert payload["level"] == 2
    assert payload["current_streak"] == 4


def test_complete_lesson_already_completed_does_not_farm_exp(
    client,
    auth_headers,
    db_session: Session,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="No Farm Lesson")

    first = client.post(
        f"/api/lessons/{lesson.id}/complete",
        json={},
        headers=_complete_headers(headers, "first-call"),
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/lessons/{lesson.id}/complete",
        json={},
        headers=_complete_headers(headers, "second-call"),
    )

    assert second.status_code == 200
    payload = second.json()
    assert payload["already_completed"] is True
    assert payload["exp_gained"] == 0
    assert payload["streak_bonus_exp"] == 0
