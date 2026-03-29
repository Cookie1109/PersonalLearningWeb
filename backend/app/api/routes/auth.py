from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.db.session import get_db
from app.infra.redis_client import get_redis_client
from app.models import User
from app.schemas import (
    ErrorResponseDTO,
    GenericStatusDTO,
    LoginRequestDTO,
    LoginResponseDTO,
    LogoutRequestDTO,
    RefreshTokenRequestDTO,
    RefreshTokenResponseDTO,
)
from app.services.auth_service import (
    authenticate_user,
    build_user_profile,
    issue_login_tokens,
    revoke_session,
    rotate_tokens,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

ERROR_RESPONSES = {
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    429: {"model": ErrorResponseDTO, "description": "Too Many Requests"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


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
    response: Response,
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
    current_user: User = Depends(get_current_user),
    redis_client=Depends(get_redis_client),
) -> GenericStatusDTO:
    refresh_token = request.cookies.get(settings.refresh_cookie_name)
    revoke_session(
        user_id=current_user.id,
        refresh_token=refresh_token,
        revoke_all_devices=payload.revoke_all_devices,
        redis_client=redis_client,
    )
    _clear_refresh_cookie(response)
    return GenericStatusDTO(status="ok", message="Logged out")
