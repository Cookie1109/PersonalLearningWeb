from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models import FlashcardProgress, Lesson, Quiz, QuizAttempt, Roadmap


def test_get_my_roadmaps_returns_hierarchy_and_respects_privacy(
    client,
    db_session: Session,
    create_user,
) -> None:
    owner_user, _ = create_user(email="owner@example.com", display_name="Owner")
    outsider_user, _ = create_user(email="outsider@example.com", display_name="Outsider")

    roadmap = Roadmap(
        user_id=owner_user.id,
        goal="Python Backend",
        title="Python Backend Course",
        is_active=True,
    )
    db_session.add(roadmap)
    db_session.commit()
    db_session.refresh(roadmap)

    db_session.add_all(
        [
            Lesson(
                roadmap_id=roadmap.id,
                week_number=1,
                position=1,
                title="Week 1 - Setup",
                is_completed=False,
            ),
            Lesson(
                roadmap_id=roadmap.id,
                week_number=1,
                position=2,
                title="Week 1 - Variables",
                is_completed=True,
            ),
            Lesson(
                roadmap_id=roadmap.id,
                week_number=2,
                position=1,
                title="Week 2 - Functions",
                is_completed=False,
            ),
            Lesson(
                roadmap_id=roadmap.id,
                week_number=2,
                position=2,
                title="Week 2 - Modules",
                is_completed=False,
            ),
        ]
    )
    db_session.commit()

    lessons = list(
        db_session.scalars(
            select(Lesson)
            .where(Lesson.roadmap_id == roadmap.id)
            .order_by(Lesson.id.asc())
        )
    )

    quiz_lesson = next(lesson for lesson in lessons if lesson.title == "Week 1 - Variables")
    flashcard_lesson = next(lesson for lesson in lessons if lesson.title == "Week 2 - Functions")

    quiz = Quiz(lesson_id=quiz_lesson.id, model_name="gemini-2.5-flash")
    db_session.add(quiz)
    db_session.commit()
    db_session.refresh(quiz)

    db_session.add(
        QuizAttempt(
            user_id=owner_user.id,
            quiz_id=quiz.id,
            score=90,
            passed=True,
            reward_granted=True,
            answers_json={"1": "A"},
        )
    )
    db_session.add(
        FlashcardProgress(
            user_id=owner_user.id,
            lesson_id=flashcard_lesson.id,
        )
    )
    db_session.commit()

    owner_token, _ = create_access_token(user_id=owner_user.id, email=owner_user.email)
    owner_headers = {"Authorization": f"Bearer {owner_token}"}

    owner_response = client.get("/api/roadmaps/me", headers=owner_headers)
    assert owner_response.status_code == 200

    owner_payload = owner_response.json()
    assert isinstance(owner_payload, list)
    assert len(owner_payload) == 1

    owner_roadmap = owner_payload[0]
    assert "weeks" in owner_roadmap
    assert len(owner_roadmap["weeks"]) == 2
    assert all("lessons" in week for week in owner_roadmap["weeks"])

    lessons_by_title = {
        lesson["title"]: lesson
        for week in owner_roadmap["weeks"]
        for lesson in week["lessons"]
    }

    assert lessons_by_title["Week 1 - Setup"]["quiz_passed"] is False
    assert lessons_by_title["Week 1 - Setup"]["flashcard_completed"] is False
    assert lessons_by_title["Week 1 - Variables"]["quiz_passed"] is True
    assert lessons_by_title["Week 1 - Variables"]["flashcard_completed"] is False
    assert lessons_by_title["Week 2 - Functions"]["quiz_passed"] is False
    assert lessons_by_title["Week 2 - Functions"]["flashcard_completed"] is True

    total_lessons = sum(len(week["lessons"]) for week in owner_roadmap["weeks"])
    assert total_lessons == 4

    outsider_token, _ = create_access_token(user_id=outsider_user.id, email=outsider_user.email)
    outsider_headers = {"Authorization": f"Bearer {outsider_token}"}

    outsider_response = client.get("/api/roadmaps/me", headers=outsider_headers)
    assert outsider_response.status_code == 200

    outsider_payload = outsider_response.json()
    assert isinstance(outsider_payload, list)
    assert outsider_payload == []
