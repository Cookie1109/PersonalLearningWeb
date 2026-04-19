from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ChatMessage


def _auth_headers_for_user(*, user) -> dict[str, str]:
    firebase_uid = user.firebase_uid or f"uid-{user.id}"
    token = f"test-firebase-token|{firebase_uid}|{user.email}"
    return {"Authorization": f"Bearer {token}"}


def test_chat_post_persists_user_and_assistant_messages(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers

    import app.services.chat_service as chat_service

    monkeypatch.setattr(
        chat_service,
        "generate_chat_reply",
        lambda *, messages, system_prompt=chat_service.SYSTEM_PROMPT: (
            "## Goi y hoc tap\n"
            "Ban nen bat dau voi bai toan nho va on tap theo chu de.\n\n"
            "[SUGGEST_ROADMAP: Python Backend]"
        ),
    )

    response = client.post(
        "/api/chat",
        json={
            "messages": [
                {
                    "role": "user",
                    "content": "Toi muon hoc Python backend",
                }
            ]
        },
        headers=headers,
    )

    assert response.status_code == 200
    assert "reply" in response.json()

    records = list(
        db_session.scalars(
            select(ChatMessage)
            .where(ChatMessage.user_id == user.id)
            .order_by(ChatMessage.id.asc())
        )
    )

    assert len(records) == 2
    assert records[0].role == "user"
    assert records[0].content == "Toi muon hoc Python backend"
    assert records[1].role == "assistant"
    assert "SUGGEST_ROADMAP" in records[1].content

    history_response = client.get("/api/chat/history", headers=headers)
    assert history_response.status_code == 200

    history = history_response.json()
    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[1]["role"] == "assistant"


def test_chat_history_returns_only_current_user_messages(
    client,
    db_session: Session,
    create_user,
) -> None:
    owner, _ = create_user(email="owner@example.com", display_name="Owner")
    outsider, _ = create_user(email="outsider@example.com", display_name="Outsider")

    owner_headers = _auth_headers_for_user(user=owner)

    db_session.add(ChatMessage(user_id=outsider.id, role="user", content="Outsider message"))
    db_session.add(ChatMessage(user_id=outsider.id, role="assistant", content="Outsider reply"))
    db_session.commit()

    response = client.get("/api/chat/history", headers=owner_headers)

    assert response.status_code == 200
    assert response.json() == []
