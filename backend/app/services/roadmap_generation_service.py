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
from app.models.fsrs_graph_models import ConceptTag
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
class GeneratedLessonPlan:
    title: str
    concept_tags: list[str]


@dataclass
class GeneratedWeekPlan:
    week: int
    title: str
    lessons: list[GeneratedLessonPlan]


def build_roadmap_prompt(goal: str, user_concepts: list[str] | None = None) -> str:
    """
    Build a constrained roadmap generation prompt grounded in the user's
    existing Knowledge Graph concepts and Bloom's Taxonomy micro-steps.
    """
    kg_section = ""
    if user_concepts:
        concept_list = ", ".join(f'"{c}"' for c in user_concepts[:30])
        kg_section = (
            f"KNOWLEDGE GRAPH CUA NGUOI DUNG: Nguoi dung da tich luy cac khai niem sau tu tai lieu ho da tai len: [{concept_list}]. "
            "Hay UU TIEN xay dung cac buoc lo trinh LIEN KET va TAI SU DUNG cac khai niem nay. "
            "Neu buoc nao su dung khai niem co san, them nhan '[tu KG]' vao cuoi ten buoc. "
        )

    bloom_section = (
        "Ap dung Bloom's Taxonomy (Thang do Nhan thuc Bloom): "
        "Mo dau bang muc Remember/Understand (ghi nho, hieu khai niem), "
        "tien dan len Apply/Analyze (ap dung, phan tich), "
        "ket thuc bang Evaluate/Create (danh gia, sang tao). "
        "Moi buoc hoc chi mat 15-20 phut de hoan thanh. "
        "BAT BUOC: Chia buoc cu the, thuc te — KHONG co buoc mo ho nhu 'Tong quan' hay 'Gioi thieu'. "
    )

    return (
        "Ban la mot Chuyen gia Dao tao Da linh vuc (Polymath) hang dau the gioi. "
        "TUYET DOI KHONG su dung cac thuat ngu IT/Lap trinh neu chu de khong lien quan den cong nghe. "
        f"{kg_section}"
        f"{bloom_section}"
        "Return ONLY valid JSON array with this schema: "
        '[{"week": 1, "title": "...", "lessons": [{"title": "...", "concept_tags": ["tag1", "tag2"]}]}]. '
        "Rules: include at least 4 weeks, each week must have 3-5 lessons (micro-steps 15-20 min each), "
        "lesson titles must be a concrete skill, concept or practice task, no markdown, no prose outside JSON. "
        "For each lesson, provide 1-3 concept_tags (keywords) that this lesson will cover. "
        "TUYET DOI KHONG lap lai cau noi cua nguoi dung trong ten bai hoc. "
        "Ten bai hoc phai la mot ky nang, khai niem hoac buoc thuc hanh cu the. "
        "Vi du ung dung Bloom: 'Dinh nghia khai niem X [Remember]', "
        "'Phan tich su khac biet giua X va Y [Analyze]', 'Xay dung Y dau tien [Create]'. "
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
    cleaned_json = _extract_json_array_text(raw_llm_json)
    try:
        payload = json.loads(cleaned_json)
    except json.JSONDecodeError:
        logger.exception("roadmap.invalid_json_from_llm raw_preview=%s", raw_llm_json[:500])
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)

    # Auto-repair wrapper dictionary containing array
    if isinstance(payload, dict):
        for key, value in payload.items():
            if isinstance(value, list) and value:
                payload = value
                break

    if not isinstance(payload, list) or not payload:
        logger.error("roadmap.empty_or_invalid_payload payload_type=%s", type(payload).__name__)
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)

    week_plans: list[GeneratedWeekPlan] = []
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            continue

        raw_week = item.get("week")
        if isinstance(raw_week, int):
            week_no = raw_week
        elif isinstance(raw_week, str):
            digits = "".join(c for c in raw_week if c.isdigit())
            week_no = int(digits) if digits else index
        else:
            week_no = index
        week_title = str(item.get("title", f"Week {index}")).strip() or f"Week {index}"
        raw_lessons = item.get("lessons", [])

        lessons: list[GeneratedLessonPlan] = []
        if isinstance(raw_lessons, list):
            for raw_lesson in raw_lessons:
                if isinstance(raw_lesson, dict):
                    lesson_title = str(raw_lesson.get("title", "")).strip()
                    raw_tags = raw_lesson.get("concept_tags", [])
                    tags: list[str] = []
                    seen_tags = set()
                    if isinstance(raw_tags, list):
                        for tag in raw_tags:
                            val = str(tag).strip()
                            if val:
                                val_lower = val.lower()
                                if val_lower not in seen_tags:
                                    seen_tags.add(val_lower)
                                    tags.append(val[:100])
                    if lesson_title:
                        lessons.append(GeneratedLessonPlan(title=lesson_title[:255], concept_tags=tags[:3]))
                elif isinstance(raw_lesson, str): # Fallback
                    lesson_title = str(raw_lesson).strip()
                    if lesson_title:
                        lessons.append(GeneratedLessonPlan(title=lesson_title[:255], concept_tags=[]))

        if len(lessons) < 2:
            lessons.extend(
                [
                    GeneratedLessonPlan(title=f"Chu de trong tam - {week_title}", concept_tags=[]),
                    GeneratedLessonPlan(title=f"Thuc hanh va tong ket - {week_title}", concept_tags=[]),
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


def _get_user_concepts(db: Session, user_id: int) -> list[str]:
    """Fetch user's accumulated concept tags from Knowledge Graph."""
    tags = list(
        db.scalars(
            select(ConceptTag)
            .where(ConceptTag.user_id == user_id)
            .order_by(ConceptTag.created_at.desc())
            .limit(40)
        )
    )
    return [tag.name for tag in tags]


def generate_and_store_roadmap(*, db: Session, user_id: int, goal: str) -> RoadmapGenerateResponseDTO:
    # Fetch user's Knowledge Graph concepts to ground the prompt
    user_concepts = _get_user_concepts(db=db, user_id=user_id)
    logger.info(
        "roadmap.kg_context user_id=%s concept_count=%d",
        user_id,
        len(user_concepts),
    )

    prompt = build_roadmap_prompt(goal, user_concepts=user_concepts if user_concepts else None)
    logger.info("roadmap.prompt_created", extra={"prompt_length": len(prompt)})

    raw_llm_json = request_roadmap_from_llm(prompt=prompt)
    week_plans = _parse_week_plans(raw_llm_json)

    try:
        active_roadmaps = list(
            db.scalars(select(Roadmap).where(Roadmap.user_id == user_id, Roadmap.is_active.is_(True)))
        )
        
        # Calculate next version for the same goal
        next_version = 1
        for active in active_roadmaps:
            if active.goal.strip().lower() == goal.strip().lower():
                next_version = max(next_version, active.version + 1)
            active.is_active = False

        roadmap = Roadmap(
            user_id=user_id,
            goal=goal.strip(),
            title=f"Lo trinh cho: {goal.strip()[:180]}",
            version=next_version,
            is_active=True,
        )
        db.add(roadmap)
        db.flush()

        existing_tags_map = {
            tag.name.lower(): tag 
            for tag in db.scalars(select(ConceptTag).where(ConceptTag.user_id == user_id))
        }

        lesson_group: dict[int, list[Lesson]] = defaultdict(list)
        week_title_map: dict[int, str] = {}

        for week_plan in week_plans:
            week_title_map[week_plan.week] = week_plan.title
            for position, lesson_plan in enumerate(week_plan.lessons, start=1):
                lesson = Lesson(
                    roadmap_id=roadmap.id,
                    user_id=user_id,
                    week_number=week_plan.week,
                    position=position,
                    title=lesson_plan.title,
                    content_markdown=None,
                    version=1,
                    is_completed=False,
                )
                
                for tag_name in lesson_plan.concept_tags:
                    tag_name_lower = tag_name.lower()
                    if tag_name_lower in existing_tags_map:
                        lesson.concept_tags.append(existing_tags_map[tag_name_lower])
                    else:
                        new_tag = ConceptTag(user_id=user_id, name=tag_name)
                        db.add(new_tag)
                        existing_tags_map[tag_name_lower] = new_tag
                        lesson.concept_tags.append(new_tag)

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
                        concept_tags=[t.name for t in lesson.concept_tags],
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
