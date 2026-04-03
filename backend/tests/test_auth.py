from datetime import UTC, datetime, timedelta

import jwt
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.models import ExpLedger


def test_login_success_returns_tokens(client: TestClient, create_user) -> None:
    user, password = create_user()

    response = client.post(
        "/api/auth/login",
        json={
            "email": user.email,
            "password": password,
            "device_id": "device-0001",
        },
    )

    assert response.status_code == 200
    payload = response.json()

    assert payload["access_token"]
    assert payload["token_type"] == "bearer"
    assert payload["expires_in"] > 0
    assert payload["user"]["user_id"] == user.id
    assert payload["user"]["email"] == user.email
    assert payload["user"]["current_streak"] == 0
    assert payload["user"]["total_study_days"] == 0
    assert response.cookies.get("refresh_token") is not None


def test_login_wrong_password_returns_401(client: TestClient, create_user) -> None:
    user, _ = create_user()

    response = client.post(
        "/api/auth/login",
        json={
            "email": user.email,
            "password": "WrongPass123!",
            "device_id": "device-0001",
        },
    )

    assert response.status_code == 401
    payload = response.json()
    assert payload["message"] == "Invalid credentials"
    assert payload["detail"]["code"] == "INVALID_CREDENTIALS"


def test_logout_accepts_expired_access_token(client: TestClient, create_user) -> None:
    user, _ = create_user()
    settings = get_settings()

    now = datetime.now(UTC)
    expired_payload = {
        "sub": str(user.id),
        "email": user.email,
        "type": "access",
        "iat": int((now - timedelta(minutes=30)).timestamp()),
        "exp": int((now - timedelta(minutes=5)).timestamp()),
    }
    expired_token = jwt.encode(expired_payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    response = client.post(
        "/api/auth/logout",
        json={"revoke_all_devices": False},
        headers={"Authorization": f"Bearer {expired_token}"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_logout_without_access_token_still_returns_200(client: TestClient) -> None:
    response = client.post(
        "/api/auth/logout",
        json={"revoke_all_devices": False},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_auth_activity_returns_last_365_days_aggregated(
    client: TestClient,
    create_user,
    db_session,
) -> None:
    user, password = create_user()

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

    login_response = client.post(
        "/api/auth/login",
        json={
            "email": user.email,
            "password": password,
            "device_id": "device-0001",
        },
    )
    assert login_response.status_code == 200
    access_token = login_response.json()["access_token"]

    response = client.get(
        "/api/auth/activity",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert any(item["date"] == today_iso and item["count"] >= 2 for item in payload)
    assert all(item["date"] != old_iso for item in payload)


def test_auth_me_returns_profile_with_gamification_fields(client: TestClient, create_user, db_session) -> None:
    user, password = create_user()
    user.current_streak = 5
    user.streak = 5
    db_session.commit()

    login_response = client.post(
        "/api/auth/login",
        json={
            "email": user.email,
            "password": password,
            "device_id": "device-0001",
        },
    )
    assert login_response.status_code == 200
    access_token = login_response.json()["access_token"]

    response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == user.id
    assert payload["current_streak"] == 5
    assert "total_study_days" in payload
