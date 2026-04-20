from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import ExpLedger, User
from app.services.cloudinary_service import CloudinaryUploadResult


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


def test_auth_me_counts_total_study_days_by_local_utc_plus_7_date(client: TestClient, create_user, db_session) -> None:
    user, _ = create_user(email="profile-local-days@example.com", display_name="Local Day User")
    timezone = ZoneInfo("Asia/Ho_Chi_Minh")

    first_local = datetime(2026, 4, 20, 0, 30, tzinfo=timezone).astimezone(UTC)
    second_local_same_day = datetime(2026, 4, 20, 9, 0, tzinfo=timezone).astimezone(UTC)

    db_session.add_all(
        [
            ExpLedger(
                user_id=user.id,
                lesson_id=None,
                quiz_id=None,
                action_type="READ_DOCUMENT",
                target_id="local-day-a",
                reward_type="gamification_track",
                exp_amount=10,
                metadata_json={"source": "test"},
                awarded_at=first_local,
            ),
            ExpLedger(
                user_id=user.id,
                lesson_id=None,
                quiz_id=None,
                action_type="READ_DOCUMENT",
                target_id="local-day-b",
                reward_type="gamification_track",
                exp_amount=15,
                metadata_json={"source": "test"},
                awarded_at=second_local_same_day,
            ),
        ]
    )
    db_session.commit()

    headers = _auth_headers(firebase_uid=user.firebase_uid or f"uid-{user.id}", email=user.email)
    response = client.get("/api/auth/me", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_study_days"] == 1


def test_auth_activity_returns_last_365_days_aggregated(
    client: TestClient,
    create_user,
    db_session,
) -> None:
    user, _ = create_user(email="activity@example.com", display_name="Activity User")

    timezone = ZoneInfo("Asia/Ho_Chi_Minh")
    now = datetime.now(UTC)
    today_local_iso = now.astimezone(timezone).date().isoformat()
    old_local_iso = (now - timedelta(days=500)).astimezone(timezone).date().isoformat()

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
    assert any(item["date"] == today_local_iso and item["count"] >= 2 for item in payload)
    assert all(item["date"] != old_local_iso for item in payload)


def test_auth_activity_groups_entries_by_local_utc_plus_7_day_boundary(
    client: TestClient,
    create_user,
    db_session,
) -> None:
    user, _ = create_user(email="activity-boundary@example.com", display_name="Activity Boundary")
    timezone = ZoneInfo("Asia/Ho_Chi_Minh")

    local_day = datetime.now(UTC).astimezone(timezone).date() - timedelta(days=1)
    next_local_day = local_day + timedelta(days=1)

    first_same_day = datetime(local_day.year, local_day.month, local_day.day, 0, 20, tzinfo=timezone).astimezone(UTC)
    second_same_day = datetime(local_day.year, local_day.month, local_day.day, 23, 40, tzinfo=timezone).astimezone(UTC)
    first_next_day = datetime(next_local_day.year, next_local_day.month, next_local_day.day, 0, 10, tzinfo=timezone).astimezone(UTC)

    db_session.add_all(
        [
            ExpLedger(
                user_id=user.id,
                lesson_id=None,
                quiz_id=None,
                reward_type="lesson_complete",
                exp_amount=40,
                metadata_json={"source": "boundary-a"},
                awarded_at=first_same_day,
            ),
            ExpLedger(
                user_id=user.id,
                lesson_id=None,
                quiz_id=None,
                reward_type="quiz_pass",
                exp_amount=60,
                metadata_json={"source": "boundary-b"},
                awarded_at=second_same_day,
            ),
            ExpLedger(
                user_id=user.id,
                lesson_id=None,
                quiz_id="boundary-quiz",
                reward_type="quiz_pass",
                exp_amount=30,
                metadata_json={"source": "boundary-c"},
                awarded_at=first_next_day,
            ),
        ]
    )
    db_session.commit()

    headers = _auth_headers(firebase_uid=user.firebase_uid or f"uid-{user.id}", email=user.email)
    response = client.get("/api/auth/activity", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    payload_by_date = {item["date"]: item["count"] for item in payload}

    assert payload_by_date.get(local_day.isoformat()) == 2
    assert payload_by_date.get(next_local_day.isoformat()) == 1


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


def test_auth_patch_me_updates_full_name_and_avatar(client: TestClient, create_user, db_session) -> None:
    user, _ = create_user(email="patch-me@example.com", display_name="Patch Me")
    headers = _auth_headers(firebase_uid=user.firebase_uid or f"uid-{user.id}", email=user.email)

    response = client.patch(
        "/api/auth/me",
        headers=headers,
        json={
            "full_name": "Updated Patch User",
            "avatar_url": "https://res.cloudinary.com/demo/image/upload/v1/avatar.png",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["full_name"] == "Updated Patch User"
    assert payload["display_name"] == "Updated Patch User"
    assert payload["avatar_url"] == "https://res.cloudinary.com/demo/image/upload/v1/avatar.png"

    db_session.refresh(user)
    assert user.display_name == "Updated Patch User"
    assert user.avatar_url == "https://res.cloudinary.com/demo/image/upload/v1/avatar.png"


def test_auth_avatar_upload_updates_avatar_url(
    client: TestClient,
    create_user,
    db_session,
    monkeypatch,
) -> None:
    import app.api.routes.auth as auth_routes

    def _fake_upload_avatar_image(*, user_id: int, file_name: str | None, content_type: str | None, file_bytes: bytes):
        _ = (user_id, file_name, content_type, file_bytes)
        return CloudinaryUploadResult(
            public_id="user_1/avatar-test",
            secure_url="https://res.cloudinary.com/demo/image/upload/v1/avatar-test.png",
            resource_type="image",
            original_filename="avatar-test.png",
            format="png",
        )

    monkeypatch.setattr(auth_routes, "upload_avatar_image", _fake_upload_avatar_image)

    user, _ = create_user(email="avatar-me@example.com", display_name="Avatar Me")
    headers = _auth_headers(firebase_uid=user.firebase_uid or f"uid-{user.id}", email=user.email)

    response = client.post(
        "/api/auth/avatar",
        headers=headers,
        files={"file": ("avatar.png", b"fake-image-data", "image/png")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["avatar_url"] == "https://res.cloudinary.com/demo/image/upload/v1/avatar-test.png"

    db_session.refresh(user)
    assert user.avatar_url == "https://res.cloudinary.com/demo/image/upload/v1/avatar-test.png"


def test_auth_avatar_upload_rejects_non_image_file(client: TestClient, create_user) -> None:
    user, _ = create_user(email="avatar-invalid@example.com", display_name="Avatar Invalid")
    headers = _auth_headers(firebase_uid=user.firebase_uid or f"uid-{user.id}", email=user.email)

    response = client.post(
        "/api/auth/avatar",
        headers=headers,
        files={"file": ("not-image.txt", b"plain text", "text/plain")},
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["detail"]["code"] == "AUTH_AVATAR_INVALID_FILE_TYPE"
