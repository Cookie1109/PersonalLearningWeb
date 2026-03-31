from datetime import UTC, datetime, timedelta

import jwt
from fastapi.testclient import TestClient

from app.core.config import get_settings


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
