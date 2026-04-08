from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.core.security import create_access_token
from app.models import Lesson


def _seed_lesson(
    db_session: Session,
    *,
    user_id: int,
    title: str = "Lesson Intro",
    source_content: str = "Control flow helps decide execution paths.",
) -> Lesson:
    lesson = Lesson(
        user_id=user_id,
        roadmap_id=None,
        week_number=1,
        position=1,
        title=title,
        source_content=source_content,
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
    assert owner_payload["youtube_video_id"] is None
    assert owner_payload["source_content"] == lesson.source_content

    outsider_token, _ = create_access_token(user_id=outsider.id, email=outsider.email)
    outsider_response = client.get(
        f"/api/lessons/{lesson.id}",
        headers={"Authorization": f"Bearer {outsider_token}"},
    )

    assert outsider_response.status_code == 404
    assert outsider_response.json()["detail"]["code"] == "LESSON_NOT_FOUND"


def test_generate_lesson_persists_grounded_markdown(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(
        db_session,
        user_id=user.id,
        title="Control Flow",
        source_content="if, else and loop constructs.",
    )

    import app.services.lesson_service as lesson_service

    generated_markdown = "## Control Flow\n\n### Khai niem then chot\n\n- if\n- loop"
    monkeypatch.setattr(
        lesson_service,
        "generate_grounded_markdown",
        lambda *, prompt: generated_markdown,
    )

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["lesson"]["id"] == lesson.id
    assert payload["lesson"]["is_draft"] is False
    assert payload["lesson"]["content_markdown"] == generated_markdown
    assert payload["lesson"]["youtube_video_id"] is None

    db_session.refresh(lesson)
    assert lesson.content_markdown == generated_markdown
    assert lesson.youtube_video_id is None
    assert lesson.version == 2


def test_generate_lesson_falls_back_when_grounded_generation_fails(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(
        db_session,
        user_id=user.id,
        title="Error Handling",
        source_content="Always handle exceptions and return controlled errors.",
    )

    import app.services.lesson_service as lesson_service

    def _raise_llm_failure(*, prompt: str) -> str:
        _ = prompt
        raise AppException(
            status_code=503,
            message="AI service timeout",
            detail={"code": "LLM_TIMEOUT"},
        )

    monkeypatch.setattr(lesson_service, "generate_grounded_markdown", _raise_llm_failure)

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["lesson"]["id"] == lesson.id
    assert payload["lesson"]["content_markdown"] is not None
    assert "## Error Handling" in payload["lesson"]["content_markdown"]
    assert "Always handle exceptions" in payload["lesson"]["content_markdown"]
    assert payload["lesson"]["youtube_video_id"] is None


def test_generate_lesson_requires_source_content(
    client,
    db_session: Session,
    auth_headers,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(
        db_session,
        user_id=user.id,
        title="Empty Source",
        source_content="",
    )

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "LESSON_SOURCE_EMPTY"


def test_build_document_theory_prompt_includes_title_and_source() -> None:
    import app.services.lesson_service as lesson_service

    prompt = lesson_service.build_document_theory_prompt(
        title="Asynchronous Programming",
        source_content="Await pauses until task completion.",
    )

    assert "NotebookLM mini" in prompt
    assert "Tieu de tai lieu: Asynchronous Programming" in prompt
    assert "Await pauses until task completion." in prompt
