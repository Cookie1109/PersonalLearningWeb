from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.exceptions import AppException
from app.db.session import get_db
from app.models import User
from app.schemas import (
    ActivityDayDTO,
    ErrorResponseDTO,
    UpdateMyProfileRequestDTO,
    UserProfileDTO,
)
from app.services.auth_service import (
    build_user_profile,
    get_user_activity_last_365_days,
)
from app.services.cloudinary_service import upload_avatar_image

router = APIRouter(prefix="/auth", tags=["auth"])
MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024

ERROR_RESPONSES = {
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


@router.get(
    "/me",
    response_model=UserProfileDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileDTO:
    return build_user_profile(db=db, user=current_user)


@router.patch(
    "/me",
    response_model=UserProfileDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def update_my_profile(
    payload: UpdateMyProfileRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileDTO:
    is_changed = False

    if "full_name" in payload.model_fields_set and payload.full_name is not None:
        current_user.display_name = payload.full_name
        is_changed = True

    if "avatar_url" in payload.model_fields_set:
        current_user.avatar_url = payload.avatar_url
        is_changed = True

    if is_changed:
        db.add(current_user)
        db.commit()
        db.refresh(current_user)

    return build_user_profile(db=db, user=current_user)


@router.post(
    "/avatar",
    response_model=UserProfileDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
async def upload_my_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileDTO:
    normalized_content_type = (file.content_type or "").split(";")[0].strip().lower()
    if not normalized_content_type.startswith("image/"):
        raise AppException(
            status_code=400,
            message="Avatar must be an image file",
            detail={"code": "AUTH_AVATAR_INVALID_FILE_TYPE"},
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise AppException(
            status_code=400,
            message="Uploaded file is empty",
            detail={"code": "AUTH_AVATAR_EMPTY_FILE"},
        )

    if len(file_bytes) > MAX_AVATAR_UPLOAD_BYTES:
        raise AppException(
            status_code=400,
            message="Avatar file exceeds 5MB limit",
            detail={"code": "AUTH_AVATAR_FILE_TOO_LARGE"},
        )

    upload_result = upload_avatar_image(
        user_id=current_user.id,
        file_name=file.filename,
        content_type=normalized_content_type,
        file_bytes=file_bytes,
    )
    current_user.avatar_url = upload_result.secure_url

    db.add(current_user)
    db.commit()
    db.refresh(current_user)

    return build_user_profile(db=db, user=current_user)


@router.get(
    "/activity",
    response_model=list[ActivityDayDTO],
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_my_activity(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ActivityDayDTO]:
    return get_user_activity_last_365_days(db=db, user_id=current_user.id)
