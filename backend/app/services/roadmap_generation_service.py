from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import HTTPException

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.models import Lesson, Roadmap
from app.schemas import LessonDTO, RoadmapGenerateResponseDTO, WeekModuleDTO

logger = logging.getLogger("app.roadmap")
AI_UNAVAILABLE_DETAIL = "Hệ thống AI đang quá tải hoặc lỗi kết nối. Vui lòng thử lại sau."


def _normalize_model_name(raw_model: str) -> str:
    model = (raw_model or "").strip()
    if model.startswith("models/"):
        model = model.split("/", 1)[1]

    legacy_map = {
        "gemini-1.5-flash": "gemini-2.5-flash",
        "gemini-1.5-pro": "gemini-2.5-pro",
    }
    return legacy_map.get(model, model)


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
        "neu chu de nguoi dung yeu câu không lien quan den cong nghe. "
        "Return ONLY valid JSON array with this schema: "
        "[{\"week\": 1, \"title\": \"...\", \"lessons\": [\"...\", \"...\"]}]. "
        "Rules: include at least 4 weeks, each week must have at least 2 lessons, "
        "lesson titles must be short and practical, no markdown, no prose outside JSON. "
        "TUYET DOI KHONG lap lai câu noi cua nguoi dung trong ten bài học. "
        "Ten bài học phai la mot ky nang, khai niem hoac buoc thuc hanh cu the trong nganh do. "
        "Vi du: neu nguoi dung muon 'hoc nau an', bài học phai la 'Ky nang thai hanh tay', "
        "KHONG DUOC dat la 'Tong quan hoc nau an'. "
        f"Learning goal: {goal.strip()}"
    )


def _extract_gemini_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""

    first_candidate = candidates[0]
    if not isinstance(first_candidate, dict):
        return ""

    content = first_candidate.get("content")
    if not isinstance(content, dict):
        return ""

    parts = content.get("parts")
    if not isinstance(parts, list):
        return ""

    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            chunks.append(text.strip())

    return "\n\n".join(chunks).strip()


def _extract_json_array_text(raw_text: str) -> str:
    stripped = raw_text.strip()
    if not stripped:
        return stripped

    if "```" in stripped:
        fence_start = stripped.find("[")
        fence_end = stripped.rfind("]")
        if fence_start != -1 and fence_end != -1 and fence_end > fence_start:
            return stripped[fence_start : fence_end + 1].strip()

    return stripped


def request_roadmap_from_llm(*, prompt: str) -> str:
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        logger.error("roadmap.llm_api_key_missing")
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)

    configured_model = settings.gemini_model.strip() or "gemini-2.5-flash"
    model_name = _normalize_model_name(configured_model)
    if model_name != configured_model:
        logger.warning("roadmap.remap_legacy_model from=%s to=%s", configured_model, model_name)
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
    timeout_seconds = max(60.0, float(settings.gemini_timeout_seconds))

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 4096,
        },
    }

    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            response = client.post(endpoint, params={"key": api_key}, json=payload)
    except httpx.TimeoutException:
        logger.exception(
            "roadmap.llm_timeout model=%s timeout_seconds=%.1f",
            model_name,
            timeout_seconds,
        )
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)
    except httpx.RequestError:
        logger.exception("roadmap.llm_network_error model=%s endpoint=%s", model_name, endpoint)
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)

    if response.status_code >= 400:
        logger.error(
            "roadmap.llm_http_error status_code=%s body=%s",
            response.status_code,
            getattr(response, "text", "")[:500],
        )
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)

    try:
        response_payload = response.json()
    except ValueError:
        logger.exception(
            "roadmap.llm_invalid_json_response status_code=%s body=%s",
            response.status_code,
            getattr(response, "text", "")[:500],
        )
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)

    roadmap_text = _extract_gemini_text(response_payload)
    if not roadmap_text:
        logger.error("roadmap.llm_empty_response payload_preview=%s", str(response_payload)[:500])
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)

    return _extract_json_array_text(roadmap_text)


def _parse_week_plans(raw_llm_json: str) -> list[GeneratedWeekPlan]:
    try:
        payload = json.loads(raw_llm_json)
    except json.JSONDecodeError:
        logger.exception("roadmap.invalid_json_from_llm raw_preview=%s", raw_llm_json[:500])
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)

    if not isinstance(payload, list) or not payload:
        logger.error("roadmap.empty_or_invalid_payload payload_type=%s", type(payload).__name__)
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)

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
        logger.error("roadmap.no_valid_week_payload raw_preview=%s", raw_llm_json[:500])
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)

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

    raw_llm_json = request_roadmap_from_llm(prompt=prompt)
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
                        description=f"Nội dung du thao cho bài học: {lesson.title}",
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

