from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.models import Lesson, Roadmap
from app.schemas import LessonDTO, RoadmapGenerateResponseDTO, WeekModuleDTO

logger = logging.getLogger("app.roadmap")


@dataclass
class GeneratedWeekPlan:
    week: int
    title: str
    lessons: list[str]


def build_roadmap_prompt(goal: str) -> str:
    return (
        "Ban la mot Chuyen gia Dao tao Da linh vuc (Polymath) hang dau the gioi. "
        "Ban co kha nang thiet ke lo trinh va giang day BAT KY chu de nao. "
        "TUYET DOI KHONG su dung cac thuat ngu IT/Lap trinh (nhu moi truong code, bien, cu phap...) "
        "neu chu de nguoi dung yeu cau khong lien quan den cong nghe. "
        "Return ONLY valid JSON array with this schema: "
        "[{\"week\": 1, \"title\": \"...\", \"lessons\": [\"...\", \"...\"]}]. "
        "Rules: include at least 4 weeks, each week must have at least 2 lessons, "
        "lesson titles must be short and practical, no markdown, no prose outside JSON. "
        "TUYET DOI KHONG lap lai cau noi cua nguoi dung trong ten bai hoc. "
        "Ten bai hoc phai la mot ky nang, khai niem hoac buoc thuc hanh cu the trong nganh do. "
        "Vi du: neu nguoi dung muon 'hoc nau an', bai hoc phai la 'Ky nang thai hanh tay', "
        "KHONG DUOC dat la 'Tong quan hoc nau an'. "
        f"Learning goal: {goal.strip()}"
    )


def _mock_llm_response(goal: str) -> str:
    topic = goal.strip()
    weeks = [
        {
            "week": 1,
            "title": f"Nen tang va dinh huong ve {topic}",
            "lessons": [
                f"Tong quan {topic}",
                f"Khai niem cot loi trong {topic}",
                "Muc tieu hoc tap va cach theo doi tien do",
            ],
        },
        {
            "week": 2,
            "title": "Kien thuc cot loi",
            "lessons": [
                f"Nguyen ly quan trong cua {topic}",
                "Ky nang phan tich va ra quyet dinh theo tinh huong",
                "Bai tap ung dung co huong dan",
            ],
        },
        {
            "week": 3,
            "title": "Luyen tap va ung dung",
            "lessons": [
                "Mo phong tinh huong thuc te",
                "Thuc hanh theo buoc voi phan hoi",
                "Tu danh gia diem manh va diem can cai thien",
            ],
        },
        {
            "week": 4,
            "title": "Tong ket va nang cao",
            "lessons": [
                "On tap theo chu de",
                "Bai tap tong hop hoac de an nho",
                "Danh gia ket qua va huong phat trien tiep",
            ],
        },
    ]
    return json.dumps(weeks, ensure_ascii=False)


def _parse_week_plans(raw_llm_json: str) -> list[GeneratedWeekPlan]:
    try:
        payload = json.loads(raw_llm_json)
    except json.JSONDecodeError as exc:
        raise AppException(
            status_code=503,
            message="Roadmap generator returned invalid format",
            detail={"code": "ROADMAP_GENERATOR_INVALID_JSON"},
        ) from exc

    if not isinstance(payload, list) or not payload:
        raise AppException(
            status_code=503,
            message="Roadmap generator returned empty roadmap",
            detail={"code": "ROADMAP_GENERATOR_EMPTY"},
        )

    week_plans: list[GeneratedWeekPlan] = []
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            continue

        week_no = int(item.get("week", index))
        week_title = str(item.get("title", f"Week {index}")).strip() or f"Week {index}"
        raw_lessons = item.get("lessons", [])

        lessons: list[str] = []
        if isinstance(raw_lessons, list):
            for lesson in raw_lessons:
                lesson_title = str(lesson).strip()
                if lesson_title:
                    lessons.append(lesson_title[:255])

        if len(lessons) < 2:
            lessons.extend(
                [
                    f"Chu de trong tam - {week_title}",
                    f"Thuc hanh va tong ket - {week_title}",
                ]
            )

        week_plans.append(GeneratedWeekPlan(week=week_no, title=week_title[:255], lessons=lessons))

    if not week_plans:
        raise AppException(
            status_code=503,
            message="Roadmap generator produced no valid weeks",
            detail={"code": "ROADMAP_GENERATOR_NO_VALID_WEEK"},
        )

    return week_plans


def _lesson_type_by_position(position: int, total: int) -> str:
    if position == total:
        return "project"
    if position % 2 == 0:
        return "practice"
    return "theory"


def _duration_by_type(lesson_type: str) -> str:
    if lesson_type == "project":
        return "60 phut"
    if lesson_type == "practice":
        return "45 phut"
    return "30 phut"


def generate_and_store_roadmap(*, db: Session, user_id: int, goal: str) -> RoadmapGenerateResponseDTO:
    prompt = build_roadmap_prompt(goal)
    logger.info("roadmap.prompt_created", extra={"prompt_length": len(prompt)})

    raw_llm_json = _mock_llm_response(goal)
    week_plans = _parse_week_plans(raw_llm_json)

    try:
        active_roadmaps = list(
            db.scalars(select(Roadmap).where(Roadmap.user_id == user_id, Roadmap.is_active.is_(True)))
        )
        for active in active_roadmaps:
            active.is_active = False

        roadmap = Roadmap(
            user_id=user_id,
            goal=goal.strip(),
            title=f"Lo trinh cho: {goal.strip()[:180]}",
            is_active=True,
        )
        db.add(roadmap)
        db.flush()

        lesson_group: dict[int, list[Lesson]] = defaultdict(list)
        week_title_map: dict[int, str] = {}

        for week_plan in week_plans:
            week_title_map[week_plan.week] = week_plan.title
            for position, lesson_title in enumerate(week_plan.lessons, start=1):
                lesson = Lesson(
                    roadmap_id=roadmap.id,
                    week_number=week_plan.week,
                    position=position,
                    title=lesson_title,
                    content_markdown=None,
                    version=1,
                    is_completed=False,
                )
                db.add(lesson)
                lesson_group[week_plan.week].append(lesson)

        db.commit()

        week_dtos: list[WeekModuleDTO] = []
        for week_no in sorted(lesson_group.keys()):
            lessons = lesson_group[week_no]
            lesson_dtos: list[LessonDTO] = []

            for lesson in lessons:
                lesson_type = _lesson_type_by_position(lesson.position, len(lessons))
                lesson_dtos.append(
                    LessonDTO(
                        id=str(lesson.id),
                        title=lesson.title,
                        duration=_duration_by_type(lesson_type),
                        completed=False,
                        type=lesson_type,
                        description=f"Noi dung du thao cho bai hoc: {lesson.title}",
                    )
                )

            week_dtos.append(
                WeekModuleDTO(
                    id=f"roadmap-{roadmap.id}-week-{week_no}",
                    week_number=week_no,
                    title=week_title_map.get(week_no, f"Week {week_no}"),
                    description=f"Chuong trinh hoc cho tuan {week_no}",
                    lessons=lesson_dtos,
                    completed=False,
                    expanded=week_no == 1,
                )
            )

        return RoadmapGenerateResponseDTO(weeks=week_dtos)
    except AppException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=409,
            message="Roadmap generation failed",
            detail={"code": "ROADMAP_GENERATION_FAILED", "error": str(exc)},
        ) from exc
