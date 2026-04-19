from __future__ import annotations

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.db.session import get_db
from app.infra.firebase_client import verify_firebase_id_token
from app.models import User
from app.services.auth_service import get_or_create_user_from_firebase_claims

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise AppException(status_code=401, message="Access token is required", detail={"code": "AUTH_TOKEN_REQUIRED"})

    payload = verify_firebase_id_token(credentials.credentials)
    uid_raw = payload.get("uid")
    if not isinstance(uid_raw, str) or not uid_raw.strip():
        raise AppException(status_code=401, message="Firebase UID is missing", detail={"code": "FIREBASE_UID_MISSING"})

    email_raw = payload.get("email")
    display_name_raw = payload.get("name")

    email = email_raw if isinstance(email_raw, str) else None
    display_name = display_name_raw if isinstance(display_name_raw, str) else None

    return get_or_create_user_from_firebase_claims(
        db,
        firebase_uid=uid_raw,
        email=email,
        display_name=display_name,
    )
