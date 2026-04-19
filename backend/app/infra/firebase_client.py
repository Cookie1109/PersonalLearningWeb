from __future__ import annotations

import json
from pathlib import Path

import firebase_admin
from firebase_admin import auth, credentials
from firebase_admin.exceptions import FirebaseError

from app.core.config import get_settings
from app.core.exceptions import AppException


def _build_credentials() -> credentials.Base:
    settings = get_settings()

    if settings.firebase_credentials_json:
        try:
            payload = json.loads(settings.firebase_credentials_json)
        except json.JSONDecodeError as exc:
            raise AppException(
                status_code=503,
                message="Firebase credentials JSON is invalid",
                detail={"code": "FIREBASE_CREDENTIALS_INVALID"},
            ) from exc
        return credentials.Certificate(payload)

    if settings.firebase_credentials_path:
        credential_path = Path(settings.firebase_credentials_path).expanduser()
        if not credential_path.exists():
            raise AppException(
                status_code=503,
                message="Firebase credentials file not found",
                detail={"code": "FIREBASE_CREDENTIALS_MISSING"},
            )
        return credentials.Certificate(str(credential_path))

    # Fallback to Application Default Credentials so environments that provide
    # ADC (or only require ID token verification) can still initialize Firebase.
    return credentials.ApplicationDefault()


def init_firebase_app(*, strict: bool) -> None:
    if firebase_admin._apps:
        return

    if not strict:
        settings = get_settings()
        if not settings.firebase_credentials_json and not settings.firebase_credentials_path:
            return

    credential = _build_credentials()
    settings = get_settings()
    options: dict[str, str] = {}
    if settings.firebase_project_id:
        options["projectId"] = settings.firebase_project_id

    try:
        firebase_admin.initialize_app(credential, options or None)
    except ValueError:
        if not firebase_admin._apps:
            raise


def verify_firebase_id_token(id_token: str) -> dict[str, object]:
    if not id_token:
        raise AppException(
            status_code=401,
            message="Access token is required",
            detail={"code": "AUTH_TOKEN_REQUIRED"},
        )

    init_firebase_app(strict=True)
    settings = get_settings()

    try:
        decoded = auth.verify_id_token(id_token, check_revoked=settings.firebase_check_revoked)
    except ValueError as exc:
        raise AppException(
            status_code=503,
            message="Firebase project is not configured correctly",
            detail={"code": "FIREBASE_PROJECT_CONFIG_INVALID"},
        ) from exc
    except auth.ExpiredIdTokenError as exc:
        raise AppException(
            status_code=401,
            message="Firebase ID token expired",
            detail={"code": "FIREBASE_ID_TOKEN_EXPIRED"},
        ) from exc
    except auth.RevokedIdTokenError as exc:
        raise AppException(
            status_code=401,
            message="Firebase ID token revoked",
            detail={"code": "FIREBASE_ID_TOKEN_REVOKED"},
        ) from exc
    except auth.InvalidIdTokenError as exc:
        raise AppException(
            status_code=401,
            message="Invalid Firebase ID token",
            detail={"code": "FIREBASE_ID_TOKEN_INVALID"},
        ) from exc
    except FirebaseError as exc:
        raise AppException(
            status_code=503,
            message="Firebase auth service unavailable",
            detail={"code": "FIREBASE_AUTH_UNAVAILABLE"},
        ) from exc

    return dict(decoded)
