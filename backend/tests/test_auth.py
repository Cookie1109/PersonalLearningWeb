from fastapi.testclient import TestClient


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
