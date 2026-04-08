from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models import Lesson


def test_get_my_documents_returns_only_owner_documents(
    client,
    db_session: Session,
    create_user,
) -> None:
    owner_user, _ = create_user(email="owner@example.com", display_name="Owner")
    outsider_user, _ = create_user(email="outsider@example.com", display_name="Outsider")

    db_session.add_all(
        [
            Lesson(
                user_id=owner_user.id,
                roadmap_id=None,
                week_number=1,
                position=1,
                title="Doc 1",
                source_content="Source 1",
                is_completed=False,
            ),
            Lesson(
                user_id=owner_user.id,
                roadmap_id=None,
                week_number=1,
                position=2,
                title="Doc 2",
                source_content="Source 2",
                is_completed=False,
            ),
            Lesson(
                user_id=outsider_user.id,
                roadmap_id=None,
                week_number=1,
                position=1,
                title="Outsider Doc",
                source_content="Private",
                is_completed=False,
            ),
        ]
    )
    db_session.commit()

    owner_token, _ = create_access_token(user_id=owner_user.id, email=owner_user.email)
    owner_headers = {"Authorization": f"Bearer {owner_token}"}

    owner_response = client.get("/api/documents", headers=owner_headers)
    assert owner_response.status_code == 200

    owner_payload = owner_response.json()
    assert isinstance(owner_payload, list)
    assert len(owner_payload) == 2
    assert {item["title"] for item in owner_payload} == {"Doc 1", "Doc 2"}
    assert all("id" in item and "created_at" in item for item in owner_payload)
    assert all(item["quiz_passed"] is False for item in owner_payload)
    assert all(item["flashcard_completed"] is False for item in owner_payload)
    assert all(item["is_completed"] is False for item in owner_payload)

    outsider_token, _ = create_access_token(user_id=outsider_user.id, email=outsider_user.email)
    outsider_headers = {"Authorization": f"Bearer {outsider_token}"}

    outsider_response = client.get("/api/documents", headers=outsider_headers)
    assert outsider_response.status_code == 200

    outsider_payload = outsider_response.json()
    assert isinstance(outsider_payload, list)
    assert len(outsider_payload) == 1
    assert outsider_payload[0]["title"] == "Outsider Doc"
