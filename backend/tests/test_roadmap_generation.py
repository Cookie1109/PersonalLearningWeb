from __future__ import annotations

import json
from unittest.mock import patch

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Lesson, Roadmap


def test_generate_roadmap_creates_draft_lessons_from_mocked_llm(
    client,
    db_session: Session,
    auth_headers,
) -> None:
    user, headers = auth_headers

    mocked_llm_output = json.dumps(
        [
            {
                "week": 1,
                "title": "Python Foundation",
                "lessons": [
                    "Setup Environment",
                    "Variables and Data Types",
                ],
            },
            {
                "week": 2,
                "title": "Core Control Flow",
                "lessons": [
                    "Conditions",
                    "Loops",
                ],
            },
        ]
    )

    with patch(
        "app.services.roadmap_generation_service.request_roadmap_from_llm",
        return_value=mocked_llm_output,
    ):
        response = client.post(
            "/api/roadmaps/generate",
            json={"goal": "Hoc Python co ban"},
            headers=headers,
        )

    assert response.status_code == 200

    active_roadmap = db_session.scalar(
        select(Roadmap).where(
            Roadmap.user_id == user.id,
            Roadmap.is_active.is_(True),
        )
    )
    assert active_roadmap is not None

    lessons = list(
        db_session.scalars(
            select(Lesson)
            .where(Lesson.roadmap_id == active_roadmap.id)
            .order_by(Lesson.week_number, Lesson.position)
        )
    )

    assert len(lessons) == 4
    assert all(lesson.is_completed is False for lesson in lessons)
    assert all(lesson.content_markdown is None for lesson in lessons)
