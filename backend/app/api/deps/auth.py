from __future__ import annotations

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_access_token(token)
    subject = payload.get("sub")

    if subject is None:
        raise AppException(status_code=401, message="Invalid access token", detail={"code": "ACCESS_TOKEN_INVALID"})

    try:
        user_id = int(subject)
    except (TypeError, ValueError) as exc:
        raise AppException(status_code=401, message="Invalid access token", detail={"code": "ACCESS_TOKEN_INVALID"}) from exc

    user = db.get(User, user_id)
    if user is None:
        raise AppException(status_code=401, message="User not found", detail={"code": "USER_NOT_FOUND"})

    return user
