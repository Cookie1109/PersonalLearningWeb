from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.models import ExpLedger, User
from app.schemas import ActivityDayDTO, UserProfileDTO
from app.services.gamification_service import get_current_streak


def get_or_create_user_from_firebase_claims(
    db: Session,
    *,
    firebase_uid: str,
    email: str | None,
    display_name: str | None,
    avatar_url: str | None,
) -> User:
    normalized_uid = firebase_uid.strip()
    if not normalized_uid:
        raise AppException(status_code=401, message="Firebase UID is missing", detail={"code": "FIREBASE_UID_MISSING"})

    normalized_email = (email or "").strip().lower()
    if not normalized_email:
        raise AppException(
            status_code=401,
            message="Firebase token does not include email",
            detail={"code": "FIREBASE_EMAIL_REQUIRED"},
        )

    normalized_display_name = (display_name or normalized_email.split("@")[0]).strip() or "Learner"
    normalized_avatar_url = (avatar_url or "").strip() or None

    existing_by_uid = db.scalar(select(User).where(User.firebase_uid == normalized_uid))
    if existing_by_uid is not None:
        changed = False
        if existing_by_uid.email != normalized_email:
            existing_by_uid.email = normalized_email
            changed = True
        if not existing_by_uid.display_name:
            existing_by_uid.display_name = normalized_display_name
            changed = True
        if normalized_avatar_url and not existing_by_uid.avatar_url:
            existing_by_uid.avatar_url = normalized_avatar_url
            changed = True

        if changed:
            try:
                db.commit()
                db.refresh(existing_by_uid)
            except IntegrityError as exc:
                db.rollback()
                raise AppException(
                    status_code=409,
                    message="Unable to sync Firebase user",
                    detail={"code": "FIREBASE_USER_SYNC_CONFLICT"},
                ) from exc
        return existing_by_uid

    existing_by_email = db.scalar(select(User).where(User.email == normalized_email))
    if existing_by_email is not None:
        existing_by_email.firebase_uid = normalized_uid
        if not existing_by_email.display_name:
            existing_by_email.display_name = normalized_display_name
        if normalized_avatar_url and not existing_by_email.avatar_url:
            existing_by_email.avatar_url = normalized_avatar_url
        try:
            db.commit()
            db.refresh(existing_by_email)
            return existing_by_email
        except IntegrityError as exc:
            db.rollback()
            raise AppException(
                status_code=409,
                message="Unable to link Firebase account",
                detail={"code": "FIREBASE_USER_LINK_CONFLICT"},
            ) from exc

    new_user = User(
        email=normalized_email,
        firebase_uid=normalized_uid,
        password_hash=None,
        display_name=normalized_display_name,
        avatar_url=normalized_avatar_url,
        level=1,
        exp=0,
        total_exp=0,
        current_streak=0,
        streak=0,
    )

    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
    except IntegrityError as exc:
        db.rollback()
        conflict_user = db.scalar(select(User).where(User.firebase_uid == normalized_uid))
        if conflict_user is not None:
            return conflict_user
        raise AppException(
            status_code=409,
            message="Unable to create Firebase user",
            detail={"code": "FIREBASE_USER_CREATE_CONFLICT"},
        ) from exc

    return new_user


def _build_local_date_expression(*, db: Session):
    dialect_name = ""
    if db.bind is not None:
        dialect_name = str(db.bind.dialect.name or "").lower()

    if dialect_name == "sqlite":
        return func.date(func.datetime(ExpLedger.awarded_at, "+7 hours"))

    return func.date(func.convert_tz(ExpLedger.awarded_at, "+00:00", "+07:00"))


def _get_total_study_days(*, db: Session, user_id: int) -> int:
    local_date_expr = _build_local_date_expression(db=db)
    total_study_days = db.scalar(
        select(func.count(func.distinct(local_date_expr))).where(ExpLedger.user_id == user_id)
    )
    return int(total_study_days or 0)


def build_user_profile(*, db: Session, user: User) -> UserProfileDTO:
    return UserProfileDTO(
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        full_name=user.display_name,
        avatar_url=user.avatar_url,
        created_at=user.created_at,
        level=user.level,
        total_exp=user.total_exp,
        current_streak=get_current_streak(user),
        total_study_days=_get_total_study_days(db=db, user_id=user.id),
    )


def get_user_activity_last_365_days(*, db: Session, user_id: int) -> list[ActivityDayDTO]:
    start_dt = datetime.now(UTC) - timedelta(days=364)
    rows = db.execute(
        select(func.date(ExpLedger.awarded_at), func.count(ExpLedger.id))
        .where(ExpLedger.user_id == user_id)
        .where(ExpLedger.awarded_at >= start_dt)
        .group_by(func.date(ExpLedger.awarded_at))
        .order_by(func.date(ExpLedger.awarded_at))
    ).all()

    activity: list[ActivityDayDTO] = []
    for awarded_date, total in rows:
        if awarded_date is None:
            continue
        activity.append(ActivityDayDTO(date=str(awarded_date), count=int(total or 0)))

    return activity

