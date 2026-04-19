from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Lesson, Question, Quiz
from app.services.quiz_generation_service import GeneratedQuizQuestion


def _auth_headers_for_user(*, user) -> dict[str, str]:
    firebase_uid = user.firebase_uid or f"uid-{user.id}"
    token = f"test-firebase-token|{firebase_uid}|{user.email}"
    return {"Authorization": f"Bearer {token}"}


def _seed_document(db_session: Session, *, user_id: int, title: str = "Doc Chat") -> Lesson:
    lesson = Lesson(
        user_id=user_id,
        roadmap_id=None,
        week_number=1,
        position=1,
        title=title,
        source_content="Nguon tai lieu noi ve event loop va bat dong bo trong JavaScript.",
        content_markdown=None,
        is_completed=False,
    )
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)
    return lesson


def _submit_current_quiz(client, *, headers: dict[str, str], quiz_payload: dict[str, object]) -> None:
    questions = quiz_payload.get("questions")
    if not isinstance(questions, list):
        raise AssertionError("Quiz payload must contain questions")

    answers = [
        {
            "question_id": str(item["question_id"]),
            "selected_option": "B",
        }
        for item in questions
    ]

    response = client.post(
        f"/api/quizzes/{quiz_payload['quiz_id']}/submit",
        json={"answers": answers},
        headers=headers,
    )
    assert response.status_code == 200


def _submit_current_document_quiz(client, *, lesson_id: int, headers: dict[str, str], quiz_payload: dict[str, object]) -> dict[str, str]:
    questions = quiz_payload.get("questions")
    if not isinstance(questions, list):
        raise AssertionError("Quiz payload must contain questions")

    selected_answers = {
        str(item["question_id"]): "B"
        for item in questions
    }

    response = client.post(
        f"/api/documents/{lesson_id}/quiz/submit",
        json={"selected_answers": selected_answers},
        headers=headers,
    )
    assert response.status_code == 200
    return selected_answers


def test_document_chat_endpoint_success(client, db_session: Session, auth_headers, monkeypatch) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id)

    import app.services.chat_service as chat_service

    captured: dict[str, object] = {}

    def _fake_generate_document_chat_reply(*, source_content: str, message: str, history: list[dict[str, str]] | None = None) -> str:
        captured["source_content"] = source_content
        captured["message"] = message
        captured["history"] = history or []
        return "Cau tra loi tu AI"

    monkeypatch.setattr(chat_service, "generate_document_chat_reply", _fake_generate_document_chat_reply)

    response = client.post(
        f"/api/documents/{lesson.id}/chat",
        json={
            "message": "Event loop la gi?",
            "history": [
                {"role": "user", "content": "Minh muon hoc JS async"},
                {"role": "assistant", "content": "Ban dang can vi du event loop"},
            ],
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["reply"] == "Cau tra loi tu AI"
    assert captured["source_content"] == lesson.source_content
    assert captured["message"] == "Event loop la gi?"
    assert isinstance(captured["history"], list)


def test_document_chat_endpoint_requires_ownership(client, db_session: Session, create_user) -> None:
    owner, _ = create_user(email="owner-chat@example.com", display_name="Owner Chat")
    outsider, _ = create_user(email="outsider-chat@example.com", display_name="Outsider Chat")
    lesson = _seed_document(db_session, user_id=owner.id, title="Private Doc")

    outsider_headers = _auth_headers_for_user(user=outsider)

    response = client.post(
        f"/api/documents/{lesson.id}/chat",
        json={"message": "Noi dung nay noi gi?", "history": []},
        headers=outsider_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "DOCUMENT_NOT_FOUND"


def test_generate_document_chat_reply_truncates_history(monkeypatch) -> None:
    import app.services.chat_service as chat_service

    captured: dict[str, object] = {}

    def _fake_generate_chat_reply(*, messages: list[dict[str, str]], system_prompt: str = "") -> str:
        captured["messages"] = messages
        captured["system_prompt"] = system_prompt
        return "ok"

    monkeypatch.setattr(chat_service, "generate_chat_reply", _fake_generate_chat_reply)

    long_history = []
    for index in range(80):
        role = "user" if index % 2 == 0 else "assistant"
        long_history.append(
            {
                "role": role,
                "content": f"message-{index} " + ("x" * 1200),
            }
        )

    reply = chat_service.generate_document_chat_reply(
        source_content="Tai lieu ve async await va event loop.",
        message="Giai thich event loop",
        history=long_history,
    )

    assert reply == "ok"
    assert "Tai lieu khong de cap den van de nay" in str(captured["system_prompt"])
    sent_messages = captured["messages"]
    assert isinstance(sent_messages, list)
    assert len(sent_messages) <= chat_service.DOCUMENT_CHAT_HISTORY_MAX_MESSAGES + 1
    assert sent_messages[-1]["role"] == "user"
    assert sent_messages[-1]["content"] == "Giai thich event loop"


def test_document_quiz_generate_and_fetch_success(client, db_session: Session, auth_headers, monkeypatch) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id, title="Doc Quiz")

    import app.services.quiz_service as quiz_service

    def _fake_generate_quiz_questions(*, lesson_title: str, source_content: str):
        _ = (lesson_title, source_content)
        return (
            "gemini-2.5-flash",
            [
                GeneratedQuizQuestion(
                    question=f"Q{index}",
                    options=[f"A{index}", f"B{index}", f"C{index}", f"D{index}"],
                    correct_index=1,
                    explanation=f"Explanation {index}",
                    question_id=index,
                    question_type="theory",
                    difficulty="Easy",
                    correct_answer=f"B{index}",
                )
                for index in range(1, 11)
            ],
        )

    monkeypatch.setattr(quiz_service, "generate_quiz_questions", _fake_generate_quiz_questions)

    generate_response = client.post(f"/api/documents/{lesson.id}/quiz/generate", json={}, headers=headers)
    assert generate_response.status_code == 200
    payload = generate_response.json()
    assert payload["lesson_id"] == str(lesson.id)
    assert len(payload["questions"]) == 10

    fetch_response = client.get(f"/api/documents/{lesson.id}/quiz", headers=headers)
    assert fetch_response.status_code == 200
    fetch_payload = fetch_response.json()
    assert fetch_payload["quiz_id"] == payload["quiz_id"]
    assert len(fetch_payload["questions"]) == 10


def test_document_quiz_generate_overwrites_existing_quiz(client, db_session: Session, auth_headers, monkeypatch) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id, title="Doc Quiz Regenerate")

    import app.services.quiz_service as quiz_service

    call_counter = {"value": 0}

    def _fake_generate_quiz_questions(*, lesson_title: str, source_content: str):
        _ = (lesson_title, source_content)
        call_counter["value"] += 1
        version = call_counter["value"]
        return (
            "gemini-2.5-flash",
            [
                GeneratedQuizQuestion(
                    question=f"Q{version}-{index}",
                    options=[f"A{version}-{index}", f"B{version}-{index}", f"C{version}-{index}", f"D{version}-{index}"],
                    correct_index=1,
                    explanation=f"Explanation {version}-{index}",
                    question_id=index,
                    question_type="theory",
                    difficulty="Easy",
                    correct_answer=f"B{version}-{index}",
                )
                for index in range(1, 11)
            ],
        )

    monkeypatch.setattr(quiz_service, "generate_quiz_questions", _fake_generate_quiz_questions)

    first_response = client.post(f"/api/documents/{lesson.id}/quiz/generate", json={}, headers=headers)
    assert first_response.status_code == 200
    first_payload = first_response.json()

    blocked_response = client.post(f"/api/documents/{lesson.id}/quiz/generate", json={}, headers=headers)
    assert blocked_response.status_code == 403
    assert blocked_response.json()["detail"]["code"] == "QUIZ_REGENERATION_REQUIRES_SUBMISSION"

    _submit_current_quiz(client, headers=headers, quiz_payload=first_payload)

    second_response = client.post(f"/api/documents/{lesson.id}/quiz/generate", json={}, headers=headers)
    assert second_response.status_code == 200
    second_payload = second_response.json()

    assert first_payload["quiz_id"] == second_payload["quiz_id"]
    assert first_payload["questions"][0]["text"] == "Q1-1"
    assert second_payload["questions"][0]["text"] == "Q2-1"

    fetched = client.get(f"/api/documents/{lesson.id}/quiz", headers=headers)
    assert fetched.status_code == 200
    fetched_payload = fetched.json()
    assert fetched_payload["questions"][0]["text"] == "Q2-1"

    quizzes = list(db_session.scalars(select(Quiz).where(Quiz.lesson_id == lesson.id)))
    assert len(quizzes) == 1

    questions = list(
        db_session.scalars(
            select(Question)
            .where(Question.quiz_id == quizzes[0].id)
            .order_by(Question.position.asc())
        )
    )
    assert len(questions) == 10
    assert questions[0].question_text == "Q2-1"


def test_document_quiz_generate_rate_limit_returns_429(client, db_session: Session, auth_headers, monkeypatch) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id, title="Doc Quiz Rate Limit")

    import app.services.quiz_service as quiz_service

    def _fake_generate_quiz_questions(*, lesson_title: str, source_content: str):
        _ = (lesson_title, source_content)
        return (
            "gemini-2.5-flash",
            [
                GeneratedQuizQuestion(
                    question=f"Q{index}",
                    options=[f"A{index}", f"B{index}", f"C{index}", f"D{index}"],
                    correct_index=1,
                    explanation=f"Explanation {index}",
                    question_id=index,
                    question_type="theory",
                    difficulty="Easy",
                    correct_answer=f"B{index}",
                )
                for index in range(1, 11)
            ],
        )

    monkeypatch.setattr(quiz_service, "generate_quiz_questions", _fake_generate_quiz_questions)

    for _ in range(3):
        response = client.post(f"/api/documents/{lesson.id}/quiz/generate", json={}, headers=headers)
        assert response.status_code == 200
        _submit_current_quiz(client, headers=headers, quiz_payload=response.json())

    rate_limited_response = client.post(f"/api/documents/{lesson.id}/quiz/generate", json={}, headers=headers)
    assert rate_limited_response.status_code == 429
    detail = rate_limited_response.json()["detail"]
    assert detail["code"] == "QUIZ_GENERATION_RATE_LIMITED"
    assert int(detail["retry_after_seconds"]) > 0


def test_document_quiz_fetch_returns_404_when_missing(client, db_session: Session, auth_headers) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id, title="Doc Without Quiz")

    response = client.get(f"/api/documents/{lesson.id}/quiz", headers=headers)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "QUIZ_NOT_FOUND"


def test_document_quiz_fetch_restores_attempt_for_current_generation(client, db_session: Session, auth_headers, monkeypatch) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id, title="Doc Quiz Restore")

    import app.services.quiz_service as quiz_service

    def _fake_generate_quiz_questions(*, lesson_title: str, source_content: str):
        _ = (lesson_title, source_content)
        return (
            "gemini-2.5-flash",
            [
                GeneratedQuizQuestion(
                    question=f"Q{index}",
                    options=[f"A{index}", f"B{index}", f"C{index}", f"D{index}"],
                    correct_index=1,
                    explanation=f"Explanation {index}",
                    question_id=index,
                    question_type="theory",
                    difficulty="Easy",
                    correct_answer=f"B{index}",
                )
                for index in range(1, 11)
            ],
        )

    monkeypatch.setattr(quiz_service, "generate_quiz_questions", _fake_generate_quiz_questions)

    generated = client.post(f"/api/documents/{lesson.id}/quiz/generate", json={}, headers=headers)
    assert generated.status_code == 200
    generated_payload = generated.json()

    selected_answers = _submit_current_document_quiz(
        client,
        lesson_id=lesson.id,
        headers=headers,
        quiz_payload=generated_payload,
    )

    fetched = client.get(f"/api/documents/{lesson.id}/quiz", headers=headers)
    assert fetched.status_code == 200
    fetched_payload = fetched.json()

    assert fetched_payload["attempt"] is not None
    attempt = fetched_payload["attempt"]
    assert attempt["score"] == 100
    assert attempt["is_passed"] is True
    assert attempt["selected_answers"] == selected_answers
    assert len(attempt["results"]) == 10


def test_document_quiz_fetch_clears_attempt_after_regenerate(client, db_session: Session, auth_headers, monkeypatch) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id, title="Doc Quiz Restore Reset")

    import app.services.quiz_service as quiz_service

    call_counter = {"value": 0}

    def _fake_generate_quiz_questions(*, lesson_title: str, source_content: str):
        _ = (lesson_title, source_content)
        call_counter["value"] += 1
        version = call_counter["value"]
        return (
            "gemini-2.5-flash",
            [
                GeneratedQuizQuestion(
                    question=f"Q{version}-{index}",
                    options=[f"A{version}-{index}", f"B{version}-{index}", f"C{version}-{index}", f"D{version}-{index}"],
                    correct_index=1,
                    explanation=f"Explanation {version}-{index}",
                    question_id=index,
                    question_type="theory",
                    difficulty="Easy",
                    correct_answer=f"B{version}-{index}",
                )
                for index in range(1, 11)
            ],
        )

    monkeypatch.setattr(quiz_service, "generate_quiz_questions", _fake_generate_quiz_questions)

    first_generated = client.post(f"/api/documents/{lesson.id}/quiz/generate", json={}, headers=headers)
    assert first_generated.status_code == 200
    first_payload = first_generated.json()

    _submit_current_document_quiz(
        client,
        lesson_id=lesson.id,
        headers=headers,
        quiz_payload=first_payload,
    )

    second_generated = client.post(f"/api/documents/{lesson.id}/quiz/generate", json={}, headers=headers)
    assert second_generated.status_code == 200

    fetched = client.get(f"/api/documents/{lesson.id}/quiz", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["attempt"] is None
