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
