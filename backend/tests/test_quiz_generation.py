from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Lesson, Question, Quiz, Roadmap
from app.services.quiz_generation_service import GeneratedQuizQuestion


def _seed_lesson(
    db_session: Session,
    *,
    user_id: int,
    title: str = "Quiz Lesson",
    content_markdown: str | None = "## Knowledge\n\nImportant facts",
) -> Lesson:
    roadmap = Roadmap(
        user_id=user_id,
        goal="Master quizzes",
        title="Quiz Roadmap",
        is_active=True,
    )
    db_session.add(roadmap)
    db_session.commit()
    db_session.refresh(roadmap)

    lesson = Lesson(
        user_id=user_id,
        roadmap_id=roadmap.id,
        week_number=1,
        position=1,
        title=title,
        source_content=(content_markdown or ""),
        content_markdown=content_markdown,
        is_completed=False,
    )
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)
    return lesson


def test_generate_quiz_creates_questions_and_get_endpoint_hides_answer_key(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Memory Systems")

    import app.services.quiz_service as quiz_service

    monkeypatch.setattr(
        quiz_service,
        "generate_quiz_questions",
        lambda *, lesson_title, source_content: (
            "gemini-1.5-flash",
            [
                GeneratedQuizQuestion(
                    question="Q1",
                    options=["A1", "B1", "C1", "D1"],
                    correct_index=1,
                    explanation="Detailed explanation 1",
                ),
                GeneratedQuizQuestion(
                    question="Q2",
                    options=["A2", "B2", "C2", "D2"],
                    correct_index=2,
                    explanation="Detailed explanation 2",
                ),
                GeneratedQuizQuestion(
                    question="Q3",
                    options=["A3", "B3", "C3", "D3"],
                    correct_index=3,
                    explanation="Detailed explanation 3",
                ),
            ],
        ),
    )

    generate_response = client.post(f"/api/lessons/{lesson.id}/quiz/generate", json={}, headers=headers)
    assert generate_response.status_code == 200
    payload = generate_response.json()

    assert payload["lesson_id"] == str(lesson.id)
    assert len(payload["questions"]) == 3
    assert payload["questions"][0]["options"][0]["option_key"] == "A"
    assert "correct_index" not in payload["questions"][0]
    assert "explanation" not in payload["questions"][0]

    get_response = client.get(f"/api/lessons/{lesson.id}/quiz", headers=headers)
    assert get_response.status_code == 200
    get_payload = get_response.json()
    assert get_payload["quiz_id"] == payload["quiz_id"]
    assert len(get_payload["questions"]) == 3
    assert "correct_index" not in get_payload["questions"][0]

    stored_quiz = db_session.scalar(select(Quiz).where(Quiz.lesson_id == lesson.id))
    assert stored_quiz is not None

    stored_questions = list(
        db_session.scalars(
            select(Question)
            .where(Question.quiz_id == stored_quiz.id)
            .order_by(Question.position.asc())
        )
    )
    assert len(stored_questions) == 3
    assert stored_questions[0].correct_index == 1
    assert stored_questions[0].explanation == "Detailed explanation 1"


def test_generate_quiz_requires_lesson_content(client, db_session: Session, auth_headers) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Empty Lesson", content_markdown="")

    response = client.post(f"/api/lessons/{lesson.id}/quiz/generate", json={}, headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "LESSON_SOURCE_EMPTY"
