from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import ExpLedger, User


def _auth_headers(*, firebase_uid: str, email: str) -> dict[str, str]:
    token = f"test-firebase-token|{firebase_uid}|{email.strip().lower()}"
    return {"Authorization": f"Bearer {token}"}


def test_auth_me_returns_profile_with_gamification_fields(client: TestClient, create_user, db_session) -> None:
    user, _ = create_user(email="profile@example.com", display_name="Profile User")
    user.current_streak = 5
    user.streak = 5
    db_session.commit()

    headers = _auth_headers(firebase_uid=user.firebase_uid or f"uid-{user.id}", email=user.email)
    response = client.get("/api/auth/me", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == user.id
    assert payload["email"] == user.email
    assert payload["current_streak"] == 5
    assert "total_study_days" in payload


def test_auth_activity_returns_last_365_days_aggregated(
    client: TestClient,
    create_user,
    db_session,
) -> None:
    user, _ = create_user(email="activity@example.com", display_name="Activity User")

    now = datetime.now(UTC)
    today_iso = now.date().isoformat()
    old_iso = (now - timedelta(days=500)).date().isoformat()

    db_session.add_all(
        [
            ExpLedger(
                user_id=user.id,
                lesson_id=None,
                quiz_id=None,
                reward_type="lesson_complete",
                exp_amount=50,
                metadata_json={"source": "test"},
                awarded_at=now,
            ),
            ExpLedger(
                user_id=user.id,
                lesson_id=None,
                quiz_id=None,
                reward_type="quiz_pass",
                exp_amount=30,
                metadata_json={"source": "test"},
                awarded_at=now - timedelta(hours=2),
            ),
            ExpLedger(
                user_id=user.id,
                lesson_id=None,
                quiz_id="old-quiz",
                reward_type="quiz_pass",
                exp_amount=20,
                metadata_json={"source": "test-old"},
                awarded_at=now - timedelta(days=500),
            ),
        ]
    )
    db_session.commit()

    headers = _auth_headers(firebase_uid=user.firebase_uid or f"uid-{user.id}", email=user.email)
    response = client.get("/api/auth/activity", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert any(item["date"] == today_iso and item["count"] >= 2 for item in payload)
    assert all(item["date"] != old_iso for item in payload)


def test_auth_me_requires_token(client: TestClient) -> None:
    response = client.get("/api/auth/me")

    assert response.status_code == 401
    payload = response.json()
    assert payload["detail"]["code"] == "AUTH_TOKEN_REQUIRED"


def test_auth_me_rejects_invalid_token(client: TestClient) -> None:
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer invalid-token"})

    assert response.status_code == 401
    payload = response.json()
    assert payload["detail"]["code"] == "FIREBASE_ID_TOKEN_INVALID"


def test_auth_me_links_existing_user_by_email(client: TestClient, db_session) -> None:
    user = User(
        email="link-me@example.com",
        firebase_uid=None,
        password_hash=None,
        display_name="Link Me",
        level=1,
        exp=0,
        total_exp=0,
        current_streak=0,
        streak=0,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    headers = _auth_headers(firebase_uid="firebase-link-uid", email="link-me@example.com")
    response = client.get("/api/auth/me", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == user.id

    db_session.refresh(user)
    assert user.firebase_uid == "firebase-link-uid"


def test_auth_me_creates_user_when_not_exists(client: TestClient, db_session) -> None:
    headers = _auth_headers(firebase_uid="firebase-new-uid", email="new-user@example.com")
    response = client.get("/api/auth/me", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["email"] == "new-user@example.com"

    created_user = db_session.scalar(select(User).where(User.firebase_uid == "firebase-new-uid"))
    assert created_user is not None
    assert created_user.email == "new-user@example.com"
