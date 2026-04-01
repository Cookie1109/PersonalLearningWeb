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
INCOMPLETE_TRAILING_PATTERN = re.compile(r"[:\-\(\[/,;]$")


def _normalize_model_name(raw_model: str) -> str:
    model = (raw_model or "").strip()
    if model.startswith("models/"):
        model = model.split("/", 1)[1]

    legacy_map = {
        "gemini-1.5-flash": "gemini-2.5-flash",
        "gemini-1.5-pro": "gemini-2.5-pro",
    }
    return legacy_map.get(model, model)


def _collapse_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def build_youtube_search_query(*, lesson: Lesson) -> str:
    lesson_title = _collapse_whitespace((lesson.title or "").strip())
    if lesson_title:
        return lesson_title[:300]
    return "bai hoc"


def _build_lesson_model_candidates(settings) -> list[str]:
    configured_pro_model = (settings.gemini_pro_model or "").strip() or "gemini-1.5-pro"
    configured_flash_model = (settings.gemini_model or "").strip() or "gemini-2.5-flash"

    candidates: list[str] = []
    for candidate in (
        configured_pro_model,
        _normalize_model_name(configured_pro_model),
        configured_flash_model,
        _normalize_model_name(configured_flash_model),
    ):
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    return candidates


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
        "Bat buoc tao day du cac muc: 1) Muc tieu bai hoc, 2) Boi canh/nen tang, 3) Kien thuc cot loi, "
        "4) Phan tich chi tiet, 5) Vi du thuc te, 6) Bai tap tu luyen, 7) Tong ket. "
        "Khong duoc dung giua cau, giua muc, hoac ket thuc bang tieu de dang do. "
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


def _extract_finish_reason(payload: dict[str, Any]) -> str | None:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return None

    candidate = candidates[0]
    if not isinstance(candidate, dict):
        return None

    reason = candidate.get("finishReason")
    return reason if isinstance(reason, str) else None


def _is_markdown_truncated(markdown: str, *, finish_reason: str | None) -> bool:
    content = markdown.strip()
    if not content:
        return True

    if finish_reason == "MAX_TOKENS":
        return True

    if content.count("```") % 2 == 1:
        return True

    lines = [line.rstrip() for line in content.splitlines() if line.strip()]
    if not lines:
        return True

    last_line = lines[-1]
    if INCOMPLETE_TRAILING_PATTERN.search(last_line):
        return True

    if re.match(r"^#{1,6}\s*$", last_line):
        return True

    if re.match(r"^\d+\.\s+\S{1,6}$", last_line):
        return True

    return False


def _build_continuation_prompt(*, original_prompt: str, partial_markdown: str) -> str:
    return (
        "Noi dung bai hoc sau dang bi cat giua chung. "
        "Hay viet tiep noi dung con thieu, KHONG lap lai phan da viet, giu dung phong cach va so muc hien tai. "
        "Bat buoc ket thuc tron ven bang muc Tong ket.\n\n"
        "[Yeu cau ban dau]\n"
        f"{original_prompt}\n\n"
        "[Noi dung da co]\n"
        f"{partial_markdown[-8000:]}"
    )


def generate_lesson_markdown(*, prompt: str) -> str:
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        raise AppException(
            status_code=503,
            message="AI service is not configured",
            detail={"code": "LLM_API_KEY_MISSING"},
        )

    model_candidates = _build_lesson_model_candidates(settings)
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
            "maxOutputTokens": 6144,
        },
    }

    with httpx.Client(timeout=timeout_seconds) as client:
        for index, model_name in enumerate(model_candidates):
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            has_fallback = index < len(model_candidates) - 1

            try:
                response = client.post(endpoint, params={"key": api_key}, json=payload)
            except httpx.TimeoutException as exc:
                logger.exception(
                    "lesson.llm_timeout model=%s timeout_seconds=%.1f error=%s",
                    model_name,
                    timeout_seconds,
                    str(exc),
                )
                if has_fallback:
                    continue
                raise AppException(status_code=503, message="AI service timeout", detail={"code": "LLM_TIMEOUT"}) from exc
            except httpx.RequestError as exc:
                logger.exception(
                    "lesson.llm_network_error model=%s endpoint=%s error=%s",
                    model_name,
                    endpoint,
                    str(exc),
                )
                if has_fallback:
                    continue
                raise AppException(
                    status_code=503,
                    message="AI service network error",
                    detail={"code": "LLM_NETWORK_ERROR"},
                ) from exc

            if response.status_code in (401, 403):
                logger.error(
                    "lesson.llm_auth_failed model=%s status_code=%s body=%s",
                    model_name,
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
                    "lesson.llm_service_error model=%s status_code=%s body=%s",
                    model_name,
                    response.status_code,
                    getattr(response, "text", "")[:500],
                )
                if has_fallback and response.status_code in (404, 429, 500, 503):
                    continue
                raise AppException(
                    status_code=503,
                    message="AI service unavailable",
                    detail={"code": "LLM_SERVICE_ERROR"},
                )

            try:
                response_payload = response.json()
            except ValueError as exc:
                logger.exception(
                    "lesson.llm_invalid_json model=%s status_code=%s body=%s",
                    model_name,
                    response.status_code,
                    getattr(response, "text", "")[:500],
                )
                if has_fallback:
                    continue
                raise AppException(
                    status_code=503,
                    message="AI service returned invalid response",
                    detail={"code": "LLM_INVALID_RESPONSE"},
                ) from exc

            markdown = _extract_gemini_text(response_payload)
            if markdown:
                finish_reason = _extract_finish_reason(response_payload)
                if _is_markdown_truncated(markdown, finish_reason=finish_reason):
                    logger.warning(
                        "lesson.llm_detected_truncation model=%s finish_reason=%s",
                        model_name,
                        finish_reason,
                    )
                    continuation_payload = {
                        "contents": [
                            {
                                "role": "user",
                                "parts": [{"text": _build_continuation_prompt(original_prompt=prompt, partial_markdown=markdown)}],
                            }
                        ],
                        "generationConfig": {
                            "temperature": 0.35,
                            "maxOutputTokens": 4096,
                        },
                    }

                    try:
                        continuation_response = client.post(endpoint, params={"key": api_key}, json=continuation_payload)
                        if continuation_response.status_code < 400:
                            continuation_json = continuation_response.json()
                            continuation_text = _extract_gemini_text(continuation_json)
                            if continuation_text:
                                markdown = f"{markdown.rstrip()}\n\n{continuation_text.lstrip()}"
                    except Exception as exc:
                        logger.warning(
                            "lesson.llm_continuation_failed model=%s error=%s",
                            model_name,
                            str(exc),
                        )

                if index > 0:
                    logger.warning("lesson.llm_fallback_success model=%s", model_name)
                return markdown

            logger.error(
                "lesson.llm_empty_response model=%s status_code=%s payload_preview=%s",
                model_name,
                response.status_code,
                str(response_payload)[:500],
            )
            if has_fallback:
                continue
            raise AppException(
                status_code=503,
                message="AI service returned empty response",
                detail={"code": "LLM_EMPTY_RESPONSE"},
            )

    raise AppException(
        status_code=503,
        message="AI service unavailable",
        detail={"code": "LLM_SERVICE_ERROR"},
    )


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
        "relevanceLanguage": "vi",
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
    youtube_query = build_youtube_search_query(lesson=lesson)

    youtube_video_id = lesson.youtube_video_id
    try:
        searched_video_id = fetch_youtube_video_id(query=youtube_query)
        if searched_video_id:
            youtube_video_id = searched_video_id
    except Exception as exc:
        logger.warning(
            "lesson.youtube_lookup_failed lesson_id=%s title=%s query=%s error=%s",
            lesson.id,
            lesson.title,
            youtube_query,
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
