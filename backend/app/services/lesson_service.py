from __future__ import annotations

import logging
import re
from typing import Any

import httpx
from datetime import UTC, datetime

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.models import ExpLedger, Lesson, Roadmap, User
from app.schemas import LessonCompleteResponseDTO, LessonDetailDTO

LESSON_COMPLETE_REWARD_TYPE = "lesson_complete"
logger = logging.getLogger("app.lesson")
YOUTUBE_SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search"
YOUTUBE_VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{6,64}$")


def _to_lesson_detail(lesson: Lesson, roadmap: Roadmap) -> LessonDetailDTO:
    content = lesson.content_markdown.strip() if lesson.content_markdown else None
    return LessonDetailDTO(
        id=lesson.id,
        title=lesson.title,
        week_number=lesson.week_number,
        position=lesson.position,
        roadmap_id=roadmap.id,
        roadmap_title=roadmap.title or roadmap.goal,
        is_completed=lesson.is_completed,
        content_markdown=content,
        youtube_video_id=lesson.youtube_video_id,
        is_draft=not bool(content),
    )


def get_lesson_for_user(*, db: Session, user_id: int, lesson_id: int) -> tuple[Lesson, Roadmap]:
    result = db.execute(
        select(Lesson, Roadmap)
        .join(Roadmap, Lesson.roadmap_id == Roadmap.id)
        .where(and_(Lesson.id == lesson_id, Roadmap.user_id == user_id))
    ).first()

    if result is None:
        raise AppException(status_code=404, message="Lesson not found", detail={"code": "LESSON_NOT_FOUND"})

    lesson, roadmap = result
    return lesson, roadmap


def get_lesson_detail_for_user(*, db: Session, user_id: int, lesson_id: int) -> LessonDetailDTO:
    lesson, roadmap = get_lesson_for_user(db=db, user_id=user_id, lesson_id=lesson_id)
    return _to_lesson_detail(lesson, roadmap)


def build_lesson_generation_prompt(*, lesson: Lesson, roadmap: Roadmap) -> str:
    roadmap_title = roadmap.title or roadmap.goal
    return (
        "Ban la mot Chuyen gia Dao tao Da linh vuc (Polymath) hang dau the gioi. "
        "Ban co kha nang thiet ke lo trinh va giang day BAT KY chu de nao. "
        "TUYET DOI KHONG su dung cac thuat ngu IT/Lap trinh (nhu moi truong code, bien, cu phap...) "
        "neu chu de nguoi dung yeu cau khong lien quan den cong nghe. "
        "Hay viet bai giang chi tiet bang Markdown, de hieu, co vi du thuc te theo dung nganh cua chu de, va co phan tom tat cuoi bai. "
        "Can giu cau truc ro rang voi tieu de, bullet points va huong dan tung buoc khi can. "
        f"Bai hoc: '{lesson.title}'. "
        f"Bai hoc nay thuoc Tuan {lesson.week_number} cua Khoa hoc '{roadmap_title}'. "
        "Tra ve duy nhat noi dung Markdown, khong them giai thich ngoai le."
    )


def _extract_gemini_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""

    candidate = candidates[0]
    if not isinstance(candidate, dict):
        return ""

    content = candidate.get("content")
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


def generate_lesson_markdown(*, prompt: str) -> str:
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        raise AppException(
            status_code=503,
            message="AI service is not configured",
            detail={"code": "LLM_API_KEY_MISSING"},
        )

    model_name = settings.gemini_pro_model.strip() or "gemini-1.5-pro"
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
    timeout_seconds = max(120.0, float(settings.gemini_timeout_seconds))

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 4096,
        },
    }

    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            response = client.post(endpoint, params={"key": api_key}, json=payload)
    except httpx.TimeoutException as exc:
        logger.exception(
            "lesson.llm_timeout model=%s timeout_seconds=%.1f error=%s",
            model_name,
            timeout_seconds,
            str(exc),
        )
        raise AppException(status_code=503, message="AI service timeout", detail={"code": "LLM_TIMEOUT"}) from exc
    except httpx.RequestError as exc:
        logger.exception(
            "lesson.llm_network_error model=%s endpoint=%s error=%s",
            model_name,
            endpoint,
            str(exc),
        )
        raise AppException(
            status_code=503,
            message="AI service network error",
            detail={"code": "LLM_NETWORK_ERROR"},
        ) from exc

    if response.status_code in (401, 403):
        logger.error(
            "lesson.llm_auth_failed status_code=%s body=%s",
            response.status_code,
            getattr(response, "text", "")[:500],
        )
        raise AppException(
            status_code=503,
            message="AI service authentication failed",
            detail={"code": "LLM_AUTH_FAILED"},
        )

    if response.status_code >= 400:
        logger.error(
            "lesson.llm_service_error status_code=%s body=%s",
            response.status_code,
            getattr(response, "text", "")[:500],
        )
        raise AppException(
            status_code=503,
            message="AI service unavailable",
            detail={"code": "LLM_SERVICE_ERROR"},
        )

    try:
        response_payload = response.json()
    except ValueError as exc:
        logger.exception(
            "lesson.llm_invalid_json status_code=%s body=%s",
            response.status_code,
            getattr(response, "text", "")[:500],
        )
        raise AppException(
            status_code=503,
            message="AI service returned invalid response",
            detail={"code": "LLM_INVALID_RESPONSE"},
        ) from exc

    markdown = _extract_gemini_text(response_payload)
    if not markdown:
        logger.error(
            "lesson.llm_empty_response status_code=%s payload_preview=%s",
            response.status_code,
            str(response_payload)[:500],
        )
        raise AppException(
            status_code=503,
            message="AI service returned empty response",
            detail={"code": "LLM_EMPTY_RESPONSE"},
        )

    return markdown


def fetch_youtube_video_id(*, query: str) -> str | None:
    settings = get_settings()
    api_key = (settings.youtube_api_key or "").strip()
    normalized_query = query.strip()

    if not api_key or not normalized_query:
        return None

    params = {
        "key": api_key,
        "part": "snippet",
        "type": "video",
        "maxResults": 1,
        "q": normalized_query,
        "videoEmbeddable": "true",
    }

    with httpx.Client(timeout=20.0) as client:
        response = client.get(YOUTUBE_SEARCH_ENDPOINT, params=params)

    if response.status_code >= 400:
        raise RuntimeError(f"YouTube API error status={response.status_code} body={response.text[:300]}")

    payload = response.json()
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return None

    first_item = items[0]
    if not isinstance(first_item, dict):
        return None

    item_id = first_item.get("id")
    if not isinstance(item_id, dict):
        return None

    video_id = item_id.get("videoId")
    if not isinstance(video_id, str):
        return None

    video_id = video_id.strip()
    if not video_id or not YOUTUBE_VIDEO_ID_PATTERN.match(video_id):
        return None

    return video_id


def generate_lesson_content_for_user(*, db: Session, user_id: int, lesson_id: int) -> LessonDetailDTO:
    lesson, roadmap = get_lesson_for_user(db=db, user_id=user_id, lesson_id=lesson_id)

    prompt = build_lesson_generation_prompt(lesson=lesson, roadmap=roadmap)
    markdown = generate_lesson_markdown(prompt=prompt)
    roadmap_title = roadmap.title or roadmap.goal

    youtube_video_id = lesson.youtube_video_id
    try:
        searched_video_id = fetch_youtube_video_id(query=f"{lesson.title} {roadmap_title}")
        if searched_video_id:
            youtube_video_id = searched_video_id
    except Exception as exc:
        logger.warning(
            "lesson.youtube_lookup_failed lesson_id=%s title=%s error=%s",
            lesson.id,
            lesson.title,
            str(exc),
        )

    try:
        lesson.content_markdown = markdown
        lesson.youtube_video_id = youtube_video_id
        lesson.version = (lesson.version or 1) + 1
        db.commit()
        db.refresh(lesson)
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=409,
            message="Lesson generation failed",
            detail={"code": "LESSON_GENERATION_FAILED", "error": str(exc)},
        ) from exc

    return _to_lesson_detail(lesson, roadmap)


def complete_lesson_for_user(
    *,
    db: Session,
    user_id: int,
    lesson_id: int,
    reward_exp: int,
) -> LessonCompleteResponseDTO:
    lesson = db.scalar(
        select(Lesson)
        .join(Roadmap, Lesson.roadmap_id == Roadmap.id)
        .where(and_(Lesson.id == lesson_id, Roadmap.user_id == user_id))
    )
    if lesson is None:
        raise AppException(status_code=404, message="Lesson not found", detail={"code": "LESSON_NOT_FOUND"})

    try:
        locked_user = db.scalar(select(User).where(User.id == user_id).with_for_update())
        if locked_user is None:
            raise AppException(status_code=401, message="User not found", detail={"code": "USER_NOT_FOUND"})

        existing_reward = db.scalar(
            select(ExpLedger).where(
                and_(
                    ExpLedger.user_id == user_id,
                    ExpLedger.lesson_id == lesson_id,
                    ExpLedger.reward_type == LESSON_COMPLETE_REWARD_TYPE,
                )
            )
        )

        if existing_reward is not None:
            if not lesson.is_completed:
                lesson.is_completed = True
                lesson.completed_at = datetime.now(UTC)
                db.commit()

            return LessonCompleteResponseDTO(
                lesson_id=lesson_id,
                exp_earned=0,
                total_exp=locked_user.total_exp,
                already_completed=True,
                message="Lesson already completed",
            )

        lesson.is_completed = True
        lesson.completed_at = datetime.now(UTC)

        reward_entry = ExpLedger(
            user_id=user_id,
            lesson_id=lesson_id,
            quiz_id=None,
            reward_type=LESSON_COMPLETE_REWARD_TYPE,
            exp_amount=reward_exp,
            metadata_json={"source": LESSON_COMPLETE_REWARD_TYPE},
        )

        locked_user.total_exp += reward_exp
        db.add(reward_entry)
        db.commit()
        db.refresh(locked_user)

        return LessonCompleteResponseDTO(
            lesson_id=lesson_id,
            exp_earned=reward_exp,
            total_exp=locked_user.total_exp,
            already_completed=False,
            message="Lesson completed",
        )
    except AppException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise AppException(status_code=409, message="Lesson completion failed", detail={"code": "LESSON_COMPLETE_FAILED", "error": str(exc)}) from exc
