from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.exceptions import AppException
from app.db.session import get_db
from app.models import Lesson, Roadmap, User
from app.schemas import (
    ErrorResponseDTO,
    RoadmapAddLessonRequestDTO,
    RoadmapAddLessonResponseDTO,
    RoadmapDeleteResponseDTO,
    RoadmapGenerateRequestDTO,
    RoadmapGenerateResponseDTO,
    RoadmapItemDTO,
    RoadmapLessonItemDTO,
    RoadmapRenameTitleRequestDTO,
    RoadmapWeekItemDTO,
)
from app.services.lesson_service import get_lesson_sub_indicators_for_user
from app.services.roadmap_generation_service import generate_and_store_roadmap

router = APIRouter(prefix="/roadmaps", tags=["roadmaps"])

ERROR_RESPONSES = {
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    404: {"model": ErrorResponseDTO, "description": "Not Found"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


@router.post(
    "/generate",
    response_model=RoadmapGenerateResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def generate_roadmap(
    payload: RoadmapGenerateRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RoadmapGenerateResponseDTO:
    return generate_and_store_roadmap(db=db, user_id=current_user.id, goal=payload.goal)


@router.get(
    "/me",
    response_model=list[RoadmapItemDTO],
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def get_my_roadmaps(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RoadmapItemDTO]:
    roadmaps = list(
        db.scalars(
            select(Roadmap)
            .where(Roadmap.user_id == current_user.id)
            .order_by(Roadmap.created_at.desc(), Roadmap.id.desc())
        )
    )

    roadmap_items: list[RoadmapItemDTO] = []
    for roadmap in roadmaps:
        lessons = list(
            db.scalars(
                select(Lesson)
                .options(selectinload(Lesson.concept_tags))
                .where(Lesson.roadmap_id == roadmap.id)
                .order_by(Lesson.week_number.asc(), Lesson.position.asc(), Lesson.id.asc())
            )
        )
        lesson_ids = [lesson.id for lesson in lessons]
        progress_map = get_lesson_sub_indicators_for_user(
            db=db,
            user_id=current_user.id,
            lesson_ids=lesson_ids,
        )

        weeks_map: dict[int, list[RoadmapLessonItemDTO]] = defaultdict(list)
        for lesson in lessons:
            quiz_passed, flashcard_completed = progress_map.get(lesson.id, (False, False))
            weeks_map[lesson.week_number].append(
                RoadmapLessonItemDTO(
                    id=lesson.id,
                    title=lesson.title,
                    is_completed=lesson.is_completed,
                    quiz_passed=quiz_passed,
                    flashcard_completed=flashcard_completed,
                    concept_tags=[tag.name for tag in lesson.concept_tags],
                )
            )

        week_items = [
            RoadmapWeekItemDTO(
                week_number=week_no,
                title=f"Tuan {week_no}",
                lessons=weeks_map[week_no],
            )
            for week_no in sorted(weeks_map.keys())
        ]

        roadmap_items.append(
            RoadmapItemDTO(
                roadmap_id=roadmap.id,
                goal=roadmap.goal,
                title=roadmap.title or roadmap.goal,
                weeks=week_items,
            )
        )

    return roadmap_items


@router.patch(
    "/{roadmap_id}/title",
    response_model=RoadmapItemDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def rename_roadmap(
    roadmap_id: int,
    payload: RoadmapRenameTitleRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RoadmapItemDTO:
    roadmap = db.scalar(
        select(Roadmap).where(Roadmap.id == roadmap_id, Roadmap.user_id == current_user.id)
    )
    if not roadmap:
        raise AppException(
            status_code=404,
            message="Roadmap not found",
            detail={"code": "ROADMAP_NOT_FOUND"},
        )

    roadmap.title = payload.title
    db.commit()
    db.refresh(roadmap)

    # Return updated roadmap with its lessons
    lessons = list(
        db.scalars(
            select(Lesson)
            .options(selectinload(Lesson.concept_tags))
            .where(Lesson.roadmap_id == roadmap.id)
            .order_by(Lesson.week_number.asc(), Lesson.position.asc(), Lesson.id.asc())
        )
    )
    lesson_ids = [lesson.id for lesson in lessons]
    progress_map = get_lesson_sub_indicators_for_user(
        db=db, user_id=current_user.id, lesson_ids=lesson_ids
    )

    weeks_map: dict[int, list[RoadmapLessonItemDTO]] = defaultdict(list)
    for lesson in lessons:
        quiz_passed, flashcard_completed = progress_map.get(lesson.id, (False, False))
        weeks_map[lesson.week_number].append(
            RoadmapLessonItemDTO(
                id=lesson.id,
                title=lesson.title,
                is_completed=lesson.is_completed,
                quiz_passed=quiz_passed,
                flashcard_completed=flashcard_completed,
                concept_tags=[tag.name for tag in lesson.concept_tags],
            )
        )

    week_items = [
        RoadmapWeekItemDTO(
            week_number=week_no,
            title=f"Tuan {week_no}",
            lessons=weeks_map[week_no],
        )
        for week_no in sorted(weeks_map.keys())
    ]

    return RoadmapItemDTO(
        roadmap_id=roadmap.id,
        goal=roadmap.goal,
        title=roadmap.title or roadmap.goal,
        weeks=week_items,
    )


@router.delete(
    "/{roadmap_id}",
    response_model=RoadmapDeleteResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
def delete_roadmap(
    roadmap_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RoadmapDeleteResponseDTO:
    roadmap = db.scalar(
        select(Roadmap).where(Roadmap.id == roadmap_id, Roadmap.user_id == current_user.id)
    )
    if not roadmap:
        raise AppException(
            status_code=404,
            message="Roadmap not found",
            detail={"code": "ROADMAP_NOT_FOUND"},
        )

    db.delete(roadmap)
    db.commit()

    return RoadmapDeleteResponseDTO(
        roadmap_id=roadmap_id,
        message="Roadmap đã được xóa thành công.",
    )


@router.post(
    "/{roadmap_id}/lessons",
    response_model=RoadmapAddLessonResponseDTO,
    status_code=status.HTTP_201_CREATED,
    responses=ERROR_RESPONSES,
)
def add_lesson_to_roadmap(
    roadmap_id: int,
    payload: RoadmapAddLessonRequestDTO,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RoadmapAddLessonResponseDTO:
    roadmap = db.scalar(
        select(Roadmap).where(Roadmap.id == roadmap_id, Roadmap.user_id == current_user.id)
    )
    if not roadmap:
        raise AppException(
            status_code=404,
            message="Roadmap not found",
            detail={"code": "ROADMAP_NOT_FOUND"},
        )

    # Determine max existing position to append at end
    existing_lessons = list(
        db.scalars(
            select(Lesson)
            .where(Lesson.roadmap_id == roadmap_id)
            .order_by(Lesson.position.desc())
        )
    )
    max_position = existing_lessons[0].position if existing_lessons else 0
    new_position = max_position + 1

    # All new lessons go to week 1 (flat structure — user can reorder after)
    week_number = existing_lessons[0].week_number if existing_lessons else 1

    lesson = Lesson(
        roadmap_id=roadmap_id,
        user_id=current_user.id,
        week_number=week_number,
        position=new_position,
        title=payload.title,
        content_markdown=None,
        version=1,
        is_completed=False,
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)

    return RoadmapAddLessonResponseDTO(
        lesson_id=lesson.id,
        roadmap_id=roadmap_id,
        title=lesson.title,
        position=lesson.position,
        message="Bước học mới đã được thêm vào lộ trình.",
    )
