from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.core.security import decode_access_token
from app.db.session import get_db
from app.infra.redis_client import get_redis_client
from app.models import User
from app.schemas import (
    ErrorResponseDTO,
    GenericStatusDTO,
    LoginRequestDTO,
    LoginResponseDTO,
    LogoutRequestDTO,
    RegisterRequestDTO,
    RefreshTokenRequestDTO,
    RefreshTokenResponseDTO,
    UserProfileDTO,
)
from app.services.auth_service import (
    authenticate_user,
    build_user_profile,
    issue_login_tokens,
    register_user,
    revoke_session,
    rotate_tokens,
)
from app.services.audit_service import queue_audit_log

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

ERROR_RESPONSES = {
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    429: {"model": ErrorResponseDTO, "description": "Too Many Requests"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


def _extract_user_id_from_bearer_header(request: Request) -> int | None:
    auth_header = request.headers.get("Authorization", "").strip()
    if not auth_header.lower().startswith("bearer "):
        return None

    token = auth_header[7:].strip()
    if not token:
        return None

    try:
        payload = decode_access_token(token)
    except AppException:
        return None

    try:
        return int(payload.get("sub"))
    except (TypeError, ValueError):
        return None


@router.post(
    "/register",
    response_model=UserProfileDTO,
    status_code=status.HTTP_201_CREATED,
    responses=ERROR_RESPONSES,
)
def register(
    payload: RegisterRequestDTO,
    db: Session = Depends(get_db),
) -> UserProfileDTO:
    user = register_user(
        db,
        email=payload.email,
        password=payload.password,
        display_name=payload.display_name,
    )
    return build_user_profile(user)


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="lax",
        path=f"{settings.api_prefix}/auth",
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path=f"{settings.api_prefix}/auth",
        httponly=True,
        secure=True,
        samesite="lax",
    )


@router.post(
    "/login",
    response_model=LoginResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def login(
    payload: LoginRequestDTO,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    redis_client=Depends(get_redis_client),
) -> LoginResponseDTO:
    user = authenticate_user(db, email=payload.email, password=payload.password)
    access_token, expires_in, refresh_token = issue_login_tokens(
        user=user,
        device_id=payload.device_id,
        redis_client=redis_client,
    )

    _set_refresh_cookie(response, refresh_token)

    queue_audit_log(
        background_tasks,
        user_id=user.id,
        action="USER_LOGIN",
        resource_id=str(user.id),
        details={
            "device_id": payload.device_id,
            "request_id": getattr(request.state, "request_id", None),
            "client_ip": request.client.host if request.client else None,
        },
    )

    return LoginResponseDTO(
        access_token=access_token,
        expires_in=expires_in,
        user=build_user_profile(user),
    )


@router.post(
    "/refresh",
    response_model=RefreshTokenResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def refresh(
    payload: RefreshTokenRequestDTO,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    redis_client=Depends(get_redis_client),
) -> RefreshTokenResponseDTO:
    refresh_token = payload.refresh_token or request.cookies.get(settings.refresh_cookie_name)
    if not refresh_token:
        raise AppException(
            status_code=401,
            message="Refresh token is required",
            detail={"code": "REFRESH_TOKEN_REQUIRED"},
        )

    access_token, expires_in, next_refresh_token = rotate_tokens(
        refresh_token=refresh_token,
        device_id=payload.device_id,
        db=db,
        redis_client=redis_client,
    )
    _set_refresh_cookie(response, next_refresh_token)

    return RefreshTokenResponseDTO(access_token=access_token, expires_in=expires_in)


@router.post(
    "/logout",
    response_model=GenericStatusDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def logout(
    payload: LogoutRequestDTO,
    request: Request,
    response: Response,
    redis_client=Depends(get_redis_client),
) -> GenericStatusDTO:
    user_id = _extract_user_id_from_bearer_header(request)
    refresh_token = request.cookies.get(settings.refresh_cookie_name)

    try:
        if payload.revoke_all_devices and user_id is not None:
            revoke_session(
                user_id=user_id,
                refresh_token=refresh_token,
                revoke_all_devices=True,
                redis_client=redis_client,
            )
        elif refresh_token:
            revoke_session(
                user_id=user_id or 0,
                refresh_token=refresh_token,
                revoke_all_devices=False,
                redis_client=redis_client,
            )
    except AppException:
        # Logout is best-effort: token can already be expired/invalid, client still must be able to clear local state.
        pass

    _clear_refresh_cookie(response)
    return GenericStatusDTO(status="ok", message="Logged out")
