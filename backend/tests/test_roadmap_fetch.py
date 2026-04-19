from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Lesson


def _auth_headers_for_user(*, user) -> dict[str, str]:
    firebase_uid = user.firebase_uid or f"uid-{user.id}"
    token = f"test-firebase-token|{firebase_uid}|{user.email}"
    return {"Authorization": f"Bearer {token}"}


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

    owner_headers = _auth_headers_for_user(user=owner_user)

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

    outsider_headers = _auth_headers_for_user(user=outsider_user)

    outsider_response = client.get("/api/documents", headers=outsider_headers)
    assert outsider_response.status_code == 200

    outsider_payload = outsider_response.json()
    assert isinstance(outsider_payload, list)
    assert len(outsider_payload) == 1
    assert outsider_payload[0]["title"] == "Outsider Doc"


def test_get_my_documents_paged_supports_page_size_and_search(
    client,
    db_session: Session,
    create_user,
) -> None:
    owner_user, _ = create_user(email="paged-owner@example.com", display_name="Paged Owner")

    lessons = [
        Lesson(
            user_id=owner_user.id,
            roadmap_id=None,
            week_number=1,
            position=index,
            title=f"Langbiang {index}",
            source_content=f"Source {index}",
            is_completed=False,
        )
        for index in range(1, 13)
    ]
    lessons.append(
        Lesson(
            user_id=owner_user.id,
            roadmap_id=None,
            week_number=1,
            position=99,
            title="Lập trình Node.js",
            source_content="Source accent",
            is_completed=False,
        )
    )
    db_session.add_all(lessons)
    db_session.commit()

    owner_headers = _auth_headers_for_user(user=owner_user)

    paged_response = client.get("/api/documents/paged?page=1&page_size=9", headers=owner_headers)
    assert paged_response.status_code == 200
    paged_payload = paged_response.json()

    assert paged_payload["page"] == 1
    assert paged_payload["page_size"] == 9
    assert paged_payload["total_items"] == 13
    assert paged_payload["total_pages"] == 2
    assert len(paged_payload["items"]) == 9

    search_response = client.get("/api/documents/paged?page=1&page_size=9&search=langbiang%2012", headers=owner_headers)
    assert search_response.status_code == 200
    search_payload = search_response.json()

    assert search_payload["total_items"] == 1
    assert search_payload["total_pages"] == 1
    assert len(search_payload["items"]) == 1
    assert search_payload["items"][0]["title"] == "Langbiang 12"

    unaccent_response = client.get("/api/documents/paged?page=1&page_size=9&search=lap%20trinh", headers=owner_headers)
    assert unaccent_response.status_code == 200
    unaccent_payload = unaccent_response.json()

    assert unaccent_payload["total_items"] == 1
    assert unaccent_payload["total_pages"] == 1
    assert len(unaccent_payload["items"]) == 1
    assert unaccent_payload["items"][0]["title"] == "Lập trình Node.js"
