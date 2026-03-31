from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Lesson, Roadmap, User
from app.schemas import (
    ErrorResponseDTO,
    RoadmapGenerateRequestDTO,
    RoadmapGenerateResponseDTO,
    RoadmapItemDTO,
    RoadmapLessonItemDTO,
    RoadmapWeekItemDTO,
)
from app.services.roadmap_generation_service import generate_and_store_roadmap

router = APIRouter(prefix="/roadmaps", tags=["roadmaps"])

ERROR_RESPONSES = {
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
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
                .where(Lesson.roadmap_id == roadmap.id)
                .order_by(Lesson.week_number.asc(), Lesson.position.asc(), Lesson.id.asc())
            )
        )

        weeks_map: dict[int, list[RoadmapLessonItemDTO]] = defaultdict(list)
        for lesson in lessons:
            weeks_map[lesson.week_number].append(
                RoadmapLessonItemDTO(
                    id=lesson.id,
                    title=lesson.title,
                    is_completed=lesson.is_completed,
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
