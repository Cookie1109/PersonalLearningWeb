from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models import Lesson


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

    outsider_token, _ = create_access_token(user_id=outsider.id, email=outsider.email)
    outsider_headers = {"Authorization": f"Bearer {outsider_token}"}

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
