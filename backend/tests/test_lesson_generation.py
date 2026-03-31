from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.core.security import create_access_token
from app.models import Lesson, Roadmap


def _seed_lesson(db_session: Session, *, user_id: int, title: str = "Lesson Intro") -> Lesson:
    roadmap = Roadmap(
        user_id=user_id,
        goal="Master Python",
        title="Python Roadmap",
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
        content_markdown=None,
        is_completed=False,
    )
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)
    return lesson


def test_get_lesson_detail_requires_ownership(
    client,
    db_session: Session,
    create_user,
) -> None:
    owner, _ = create_user(email="lesson-owner@example.com")
    outsider, _ = create_user(email="lesson-outsider@example.com")

    lesson = _seed_lesson(db_session, user_id=owner.id)

    owner_token, _ = create_access_token(user_id=owner.id, email=owner.email)
    owner_response = client.get(
        f"/api/lessons/{lesson.id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    assert owner_response.status_code == 200
    owner_payload = owner_response.json()
    assert owner_payload["id"] == lesson.id
    assert owner_payload["is_draft"] is True
    assert owner_payload["content_markdown"] is None

    outsider_token, _ = create_access_token(user_id=outsider.id, email=outsider.email)
    outsider_response = client.get(
        f"/api/lessons/{lesson.id}",
        headers={"Authorization": f"Bearer {outsider_token}"},
    )

    assert outsider_response.status_code == 404
    assert outsider_response.json()["detail"]["code"] == "LESSON_NOT_FOUND"


def test_generate_lesson_persists_markdown(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Control Flow")

    generated_markdown = "## Control Flow\n\n- if\n- for\n"

    import app.services.lesson_service as lesson_service

    monkeypatch.setattr(
        lesson_service,
        "generate_lesson_markdown",
        lambda prompt: generated_markdown,
    )

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["lesson"]["id"] == lesson.id
    assert payload["lesson"]["is_draft"] is False
    assert payload["lesson"]["content_markdown"] == generated_markdown.strip()

    db_session.refresh(lesson)
    assert lesson.content_markdown == generated_markdown
    assert lesson.version == 2


def test_generate_lesson_returns_controlled_error_when_llm_fails(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Error Handling")

    import app.services.lesson_service as lesson_service

    def _raise_llm_failure(*, prompt: str) -> str:
        _ = prompt
        raise AppException(
            status_code=503,
            message="AI service timeout",
            detail={"code": "LLM_TIMEOUT"},
        )

    monkeypatch.setattr(lesson_service, "generate_lesson_markdown", _raise_llm_failure)

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "LLM_TIMEOUT"

    db_session.refresh(lesson)
    assert lesson.content_markdown is None
