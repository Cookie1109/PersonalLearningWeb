from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas import (
    ActivityDayDTO,
    ErrorResponseDTO,
    UserProfileDTO,
)
from app.services.auth_service import (
    build_user_profile,
    get_user_activity_last_365_days,
)

router = APIRouter(prefix="/auth", tags=["auth"])

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
