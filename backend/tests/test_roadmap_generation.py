from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Lesson


def test_create_document_creates_owned_lesson(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers

    import app.services.lesson_service as lesson_service

    monkeypatch.setattr(
        lesson_service,
        "generate_grounded_markdown",
        lambda *, prompt: "## Python Foundation\n\n- Variables\n- Loops",
    )

    response = client.post(
        "/api/documents",
        json={
            "title": "Python Foundation",
            "source_content": "Variables store values and loops repeat actions.",
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == "Python Foundation"
    assert payload["message"] == "Document created"

    created_lesson = db_session.scalar(
        select(Lesson).where(
            Lesson.id == payload["document_id"],
            Lesson.user_id == user.id,
        )
    )
    assert created_lesson is not None
    assert created_lesson.roadmap_id is None
    assert created_lesson.title == "Python Foundation"
    assert created_lesson.source_content.startswith("Variables store values")


def test_create_document_auto_suffixes_duplicate_title(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    _, headers = auth_headers

    import app.services.lesson_service as lesson_service

    monkeypatch.setattr(
        lesson_service,
        "generate_grounded_markdown",
        lambda *, prompt: "## Doc\n\n- Content",
    )

    payload = {
        "title": "Collision Title",
        "source_content": "This source content is long enough for document creation validation.",
    }

    first_response = client.post("/api/documents", json=payload, headers=headers)
    second_response = client.post("/api/documents", json=payload, headers=headers)

    assert first_response.status_code == 200
    assert second_response.status_code == 200

    first_title = first_response.json()["title"]
    second_title = second_response.json()["title"]

    assert first_title == "Collision Title"
    assert second_title == "Collision Title (2)"


def test_create_document_returns_ai_error_when_llm_raises_unexpected_error(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    _, headers = auth_headers

    import app.services.lesson_service as lesson_service

    def _raise_unexpected(*, prompt: str) -> str:
        _ = prompt
        raise RuntimeError("unexpected model failure")

    monkeypatch.setattr(lesson_service, "generate_grounded_markdown", _raise_unexpected)

    response = client.post(
        "/api/documents",
        json={
            "title": "Fallback LLM Error",
            "source_content": "This source text remains valid and should still create a document successfully.",
        },
        headers=headers,
    )

    assert response.status_code == 500
    payload = response.json()
    assert payload["message"].startswith("He thong AI gap loi:")
    assert payload["detail"]["code"] == "THEORY_AI_FAILED"

    created_lesson = db_session.scalar(select(Lesson).where(Lesson.title == "Fallback LLM Error"))
    assert created_lesson is None
