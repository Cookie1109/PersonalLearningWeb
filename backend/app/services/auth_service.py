from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session

from redis import Redis

from app.core.exceptions import AppException
from app.core.security import create_access_token, hash_password, verify_password
from app.models import User
from app.schemas import UserProfileDTO
from app.services.refresh_token_store import RefreshTokenStore


def authenticate_user(db: Session, *, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(password, user.password_hash):
        raise AppException(status_code=401, message="Invalid credentials", detail={"code": "INVALID_CREDENTIALS"})
    return user


def register_user(
    db: Session,
    *,
    email: str,
    password: str,
    display_name: str | None,
) -> User:
    normalized_email = email.strip().lower()
    normalized_display_name = (display_name or normalized_email.split("@")[0]).strip()

    existing_user = db.scalar(select(User).where(User.email == normalized_email))
    if existing_user is not None:
        raise AppException(
            status_code=400,
            message="Ten dang nhap da ton tai",
            detail={"code": "USER_ALREADY_EXISTS"},
        )

    user = User(
        email=normalized_email,
        password_hash=hash_password(password),
        display_name=normalized_display_name,
        level=1,
        exp=0,
        total_exp=0,
        current_streak=0,
        streak=0,
    )

    try:
        db.add(user)
        db.commit()
        db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        raise AppException(
            status_code=400,
            message="Ten dang nhap da ton tai",
            detail={"code": "USER_ALREADY_EXISTS"},
        ) from exc

    return user


def build_user_profile(user: User) -> UserProfileDTO:
    return UserProfileDTO(
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        level=user.level,
        total_exp=user.total_exp,
    )


def issue_login_tokens(*, user: User, device_id: str | None, redis_client: Redis) -> tuple[str, int, str]:
    access_token, expires_in = create_access_token(user_id=user.id, email=user.email)
    refresh_token = RefreshTokenStore(redis_client).issue_token(user_id=user.id, device_id=device_id)
    return access_token, expires_in, refresh_token


def rotate_tokens(*, refresh_token: str, device_id: str | None, db: Session, redis_client: Redis) -> tuple[str, int, str]:
    user_id, new_refresh_token = RefreshTokenStore(redis_client).rotate_token(refresh_token, device_id=device_id)
    user = db.get(User, user_id)
    if user is None:
        raise AppException(status_code=401, message="User not found", detail={"code": "USER_NOT_FOUND"})

    access_token, expires_in = create_access_token(user_id=user.id, email=user.email)
    return access_token, expires_in, new_refresh_token


def revoke_session(*, user_id: int, refresh_token: str | None, revoke_all_devices: bool, redis_client: Redis) -> None:
    store = RefreshTokenStore(redis_client)
    if revoke_all_devices:
        store.revoke_all_user_families(user_id)
        return

    if not refresh_token:
        raise AppException(status_code=401, message="Refresh token is required", detail={"code": "REFRESH_TOKEN_REQUIRED"})

    store.revoke_token_family_by_token(refresh_token)
