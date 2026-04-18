from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models import Flashcard, Lesson
from app.services.flashcard_generation_service import GeneratedFlashcard


def _seed_document(db_session: Session, *, user_id: int, title: str = "Flashcard Doc") -> Lesson:
    lesson = Lesson(
        user_id=user_id,
        roadmap_id=None,
        week_number=1,
        position=1,
        title=title,
        source_content="Tai lieu noi ve event loop, call stack va task queue trong JavaScript.",
        content_markdown=None,
        is_completed=False,
    )
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)
    return lesson


def test_generate_and_get_document_flashcards_success(client, db_session: Session, auth_headers, monkeypatch) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id)

    import app.services.flashcard_service as flashcard_service

    def _fake_generate_flashcards(*, lesson_title: str, document_text: str):
        assert lesson_title == lesson.title
        assert "event loop" in document_text.lower()
        return (
            "gemini-2.5-flash",
            [
                GeneratedFlashcard(
                    front_text="Event loop la gi?",
                    back_text="Co che dieu phoi callback trong JavaScript runtime.",
                ),
                GeneratedFlashcard(
                    front_text="Task queue dung de lam gi?",
                    back_text="Luu callback cho den khi call stack rong.",
                ),
            ],
        )

    monkeypatch.setattr(flashcard_service, "generate_flashcards", _fake_generate_flashcards)

    generate_response = client.post(f"/api/documents/{lesson.id}/flashcards/generate", headers=headers)
    assert generate_response.status_code == 200

    generated_cards = generate_response.json()
    assert len(generated_cards) == 2
    assert generated_cards[0]["status"] == "new"
    assert generated_cards[0]["document_id"] == lesson.id

    get_response = client.get(f"/api/documents/{lesson.id}/flashcards", headers=headers)
    assert get_response.status_code == 200

    cards = get_response.json()
    assert len(cards) == 2
    assert cards[0]["front_text"] == "Event loop la gi?"


def test_generate_document_flashcards_overwrites_existing_cards(client, db_session: Session, auth_headers, monkeypatch) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id, title="Flashcard Replace")

    old_card = Flashcard(
        document_id=lesson.id,
        front_text="Old front",
        back_text="Old back",
        status="new",
    )
    db_session.add(old_card)
    db_session.commit()

    import app.services.flashcard_service as flashcard_service

    def _fake_generate_flashcards(*, lesson_title: str, document_text: str):
        _ = (lesson_title, document_text)
        return (
            "gemini-2.5-flash",
            [
                GeneratedFlashcard(
                    front_text="New front",
                    back_text="New back",
                )
            ],
        )

    monkeypatch.setattr(flashcard_service, "generate_flashcards", _fake_generate_flashcards)

    generate_response = client.post(f"/api/documents/{lesson.id}/flashcards/generate", headers=headers)
    assert generate_response.status_code == 200

    stored_cards = list(db_session.scalars(select(Flashcard).where(Flashcard.document_id == lesson.id).order_by(Flashcard.id.asc())))
    assert len(stored_cards) == 1
    assert stored_cards[0].front_text == "New front"


def test_generate_document_flashcards_requires_ownership(client, db_session: Session, create_user) -> None:
    owner, _ = create_user(email="owner-flashcard@example.com", display_name="Owner")
    outsider, _ = create_user(email="outsider-flashcard@example.com", display_name="Outsider")
    lesson = _seed_document(db_session, user_id=owner.id, title="Private Flashcard Doc")

    outsider_token, _ = create_access_token(user_id=outsider.id, email=outsider.email)
    outsider_headers = {"Authorization": f"Bearer {outsider_token}"}

    response = client.post(f"/api/documents/{lesson.id}/flashcards/generate", headers=outsider_headers)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "DOCUMENT_NOT_FOUND"


def test_patch_flashcard_status_success(client, db_session: Session, auth_headers) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id, title="Patch Status")

    card = Flashcard(
        document_id=lesson.id,
        front_text="Callback queue la gi?",
        back_text="Noi luu callback cho event loop.",
        status="new",
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)

    response = client.patch(
        f"/api/flashcards/{card.id}/status",
        json={"status": "got_it"},
        headers=headers,
    )
    assert response.status_code == 200

    payload = response.json()
    assert payload["id"] == card.id
    assert payload["status"] == "got_it"

    db_session.refresh(card)
    assert card.status == "got_it"


def test_patch_flashcard_status_requires_ownership(client, db_session: Session, create_user) -> None:
    owner, _ = create_user(email="owner-status@example.com", display_name="Owner Status")
    outsider, _ = create_user(email="outsider-status@example.com", display_name="Outsider Status")

    lesson = _seed_document(db_session, user_id=owner.id, title="Private Status Doc")
    card = Flashcard(
        document_id=lesson.id,
        front_text="Front",
        back_text="Back",
        status="new",
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)

    outsider_token, _ = create_access_token(user_id=outsider.id, email=outsider.email)
    outsider_headers = {"Authorization": f"Bearer {outsider_token}"}

    response = client.patch(
        f"/api/flashcards/{card.id}/status",
        json={"status": "missed_it"},
        headers=outsider_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "FLASHCARD_NOT_FOUND"


def test_explain_flashcard_success(client, db_session: Session, auth_headers, monkeypatch) -> None:
    user, headers = auth_headers
    lesson = _seed_document(db_session, user_id=user.id, title="Explain Card")

    card = Flashcard(
        document_id=lesson.id,
        front_text="Event loop la gi?",
        back_text="Co che dieu phoi callback trong JavaScript runtime.",
        status="new",
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)

    import app.services.flashcard_service as flashcard_service

    def _fake_generate_chat_reply(*, messages, system_prompt: str = ""):
        assert system_prompt == flashcard_service.FLASHCARD_EXPLAIN_SYSTEM_PROMPT
        assert isinstance(messages, list)
        assert "Event loop la gi?" in messages[0]["content"]
        assert "cho học sinh" not in messages[0]["content"].lower()
        return "Chào các em,\n\n- Event loop giup xep hang callback va xu ly khi call stack rong."

    monkeypatch.setattr(flashcard_service, "generate_chat_reply", _fake_generate_chat_reply)

    response = client.post(
        f"/api/flashcards/{card.id}/explain",
        json={},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert "Event loop" in payload["explanation"]
    assert "Chào các em" not in payload["explanation"]


def test_explain_flashcard_requires_ownership(client, db_session: Session, create_user) -> None:
    owner, _ = create_user(email="owner-explain@example.com", display_name="Owner Explain")
    outsider, _ = create_user(email="outsider-explain@example.com", display_name="Outsider Explain")

    lesson = _seed_document(db_session, user_id=owner.id, title="Private Explain Doc")
    card = Flashcard(
        document_id=lesson.id,
        front_text="Private front",
        back_text="Private back",
        status="new",
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)

    outsider_token, _ = create_access_token(user_id=outsider.id, email=outsider.email)
    outsider_headers = {"Authorization": f"Bearer {outsider_token}"}

    response = client.post(
        f"/api/flashcards/{card.id}/explain",
        json={},
        headers=outsider_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "FLASHCARD_NOT_FOUND"
