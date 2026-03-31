from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models import Lesson, Roadmap


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

    total_lessons = sum(len(week["lessons"]) for week in owner_roadmap["weeks"])
    assert total_lessons == 4

    outsider_token, _ = create_access_token(user_id=outsider_user.id, email=outsider_user.email)
    outsider_headers = {"Authorization": f"Bearer {outsider_token}"}

    outsider_response = client.get("/api/roadmaps/me", headers=outsider_headers)
    assert outsider_response.status_code == 200

    outsider_payload = outsider_response.json()
    assert isinstance(outsider_payload, list)
    assert outsider_payload == []
