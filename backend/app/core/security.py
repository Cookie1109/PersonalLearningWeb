from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from uuid import uuid4

import jwt
from jwt import ExpiredSignatureError, InvalidTokenError
from passlib.context import CryptContext

from app.core.config import get_settings
from app.core.exceptions import AppException

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except ValueError:
        return False


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(*, user_id: int, email: str) -> tuple[str, int]:
    settings = get_settings()
    now = datetime.now(UTC)
    expires_delta = timedelta(minutes=settings.access_token_expire_minutes)
    exp = now + expires_delta

    payload = {
        "sub": str(user_id),
        "email": email,
        "type": "access",
        "jti": str(uuid4()),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }

    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    return token, int(expires_delta.total_seconds())


def decode_access_token(token: str) -> dict:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except ExpiredSignatureError as exc:
        raise AppException(status_code=401, message="Access token expired", detail={"code": "ACCESS_TOKEN_EXPIRED"}) from exc
    except InvalidTokenError as exc:
        raise AppException(status_code=401, message="Invalid access token", detail={"code": "ACCESS_TOKEN_INVALID"}) from exc

    if payload.get("type") != "access":
        raise AppException(status_code=401, message="Invalid token type", detail={"code": "ACCESS_TOKEN_INVALID_TYPE"})

    return payload


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(64)


def hash_refresh_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()
