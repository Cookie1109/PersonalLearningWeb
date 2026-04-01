from __future__ import annotations

import json
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
from app.services.gamification_service import add_exp_and_check_level, get_current_streak, get_total_exp, update_study_streak

LESSON_COMPLETE_REWARD_TYPE = "lesson_complete"
STREAK_BONUS_REWARD_TYPE = "streak_bonus"
logger = logging.getLogger("app.lesson")
YOUTUBE_SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search"
YOUTUBE_VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
INCOMPLETE_TRAILING_PATTERN = re.compile(r"[:\-\(\[/,;]$")
JSON_CODE_FENCE_PATTERN = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.IGNORECASE | re.DOTALL)

CONTEXT_KEYWORD_VARIANTS: dict[str, tuple[str, ...]] = {
    "c#": ("c#", "c sharp", "csharp"),
    ".net": (".net", "dotnet", "asp.net", "asp net"),
    "java": ("java",),
    "javascript": ("javascript", "js"),
    "typescript": ("typescript", "ts"),
    "python": ("python",),
    "php": ("php",),
    "kotlin": ("kotlin",),
    "swift": ("swift",),
    "rust": ("rust",),
    "golang": ("golang",),
}

PROGRAMMING_CONTEXT_KEYWORDS = {
    "c#",
    ".net",
    "java",
    "javascript",
    "typescript",
    "python",
    "php",
    "kotlin",
    "swift",
    "rust",
    "golang",
}


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


def _detect_context_keywords(*, lesson: Lesson, roadmap: Roadmap) -> list[str]:
    source = _collapse_whitespace(
        f"{lesson.title or ''} {roadmap.title or ''} {roadmap.goal or ''}"
    ).lower()

    detected: list[str] = []
    for canonical, variants in CONTEXT_KEYWORD_VARIANTS.items():
        if any(variant in source for variant in variants):
            detected.append(canonical)

    return detected


def _query_contains_context_keyword(*, query: str, canonical_keyword: str) -> bool:
    query_lower = query.lower()
    variants = CONTEXT_KEYWORD_VARIANTS.get(canonical_keyword, (canonical_keyword,))
    return any(variant in query_lower for variant in variants)


def enrich_youtube_query_with_context(*, query: str, lesson: Lesson, roadmap: Roadmap) -> str:
    normalized_query = _collapse_whitespace(query)
    if not normalized_query:
        normalized_query = build_youtube_search_query(lesson=lesson)

    context_keywords = _detect_context_keywords(lesson=lesson, roadmap=roadmap)
    missing_keywords = [
        keyword for keyword in context_keywords if not _query_contains_context_keyword(query=normalized_query, canonical_keyword=keyword)
    ]

    if missing_keywords:
        normalized_query = _collapse_whitespace(f"{normalized_query} {' '.join(missing_keywords)}")

    has_programming_context = any(keyword in PROGRAMMING_CONTEXT_KEYWORDS for keyword in context_keywords)
    if has_programming_context:
        lowered = normalized_query.lower()
        if "lap trinh" not in lowered and "programming" not in lowered and "code" not in lowered:
            normalized_query = _collapse_whitespace(f"lap trinh {normalized_query}")

    return normalized_query[:300]


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


def _to_lesson_detail(lesson: Lesson, roadmap: Roadmap | None) -> LessonDetailDTO:
    content = lesson.content_markdown.strip() if lesson.content_markdown else None
    if roadmap is not None:
        roadmap_id = roadmap.id
        roadmap_title = roadmap.title or roadmap.goal
    else:
        roadmap_id = int(lesson.roadmap_id or 0)
        roadmap_title = "Bai hoc tu do"

    return LessonDetailDTO(
        id=lesson.id,
        title=lesson.title,
        week_number=lesson.week_number,
        position=lesson.position,
        roadmap_id=roadmap_id,
        roadmap_title=roadmap_title,
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


def get_lesson_for_generation(*, db: Session, user_id: int, lesson_id: int) -> tuple[Lesson, Roadmap | None]:
    lesson = db.get(Lesson, lesson_id)
    if lesson is None:
        raise AppException(status_code=404, message="Lesson not found", detail={"code": "LESSON_NOT_FOUND"})

    if lesson.roadmap_id is None:
        logger.warning("lesson.roadmap_context_missing lesson_id=%s reason=no_roadmap_id", lesson.id)
        return lesson, None

    roadmap = db.get(Roadmap, lesson.roadmap_id)
    if roadmap is None:
        logger.warning(
            "lesson.roadmap_context_missing lesson_id=%s roadmap_id=%s reason=not_found",
            lesson.id,
            lesson.roadmap_id,
        )
        return lesson, None

    if roadmap.user_id != user_id:
        raise AppException(status_code=404, message="Lesson not found", detail={"code": "LESSON_NOT_FOUND"})

    return lesson, roadmap


def build_lesson_generation_prompt(*, lesson: Lesson, roadmap: Roadmap) -> str:
    roadmap_title = roadmap.title or roadmap.goal
    return (
        "Ban la chuyen gia giao duc da linh vuc. "
        "Hay viet noi dung bai hoc chi tiet bang Markdown, de hieu, dung ngu canh va thuat ngu chuyen nganh cua chu de. "
        "TUYET DOI KHONG chen cac thuat ngu IT/Lap trinh neu chu de khong lien quan cong nghe. "
        "Can giu cau truc ro rang voi tieu de, bullet points va huong dan tung buoc khi can. "
        "Neu can trinh bay du lieu bang bang bieu, BAT BUOC dung bang Markdown GFM hop le (co dong header va dong separator ---). "
        "Tuyet doi KHONG xuong dong giua mot cell hoac giua mot hang cua bang. Moi hang du lieu phai nam tren mot dong duy nhat. "
        "Bat buoc tao day du cac muc: 1) Muc tieu bai hoc, 2) Boi canh/nen tang, 3) Kien thuc cot loi, 4) Phan tich chi tiet, "
        "5) Vi du thuc te, 6) Bai tap tu luyen, 7) Tong ket. "
        "Sau khi viet xong, hay dua ra 1 cau lenh tim kiem YouTube toi uu nhat, ngan gon, chua cac thuat ngu chuyen nganh de tim video minh hoa chinh xac cho bai hoc nay. "
        "RANG BUOC THEP: Tu khoa tim kiem BAT BUOC phai bao gom ten ngon ngu lap trinh, cong cu, hoac chu de goc cua lo trinh. "
        "Vi du: neu bai hoc thuoc lo trinh C#, query phai la 'C# thuc hien cac phep toan' chu KHONG duoc ghi chung chung 'thuc hien cac phep toan'. "
        "Dieu nay cuc ky quan trong de tranh nham lan sang linh vuc khac. "
        "youtube_search_query BAT BUOC phai chua keyword cot loi cua khoa hoc. "
        "Neu muc tieu hoc co ngon ngu/nen tang cu the (vi du C#, .NET), bat buoc xuat hien ro rang trong query. "
        "BAT BUOC tra ve JSON nghiem ngat voi cau truc: "
        '{"content_markdown":"...", "youtube_search_query":"..."}. '
        "Khong kem bat ky van ban nao khac ngoai JSON. "
        f"Bai hoc: '{lesson.title}'. "
        f"Bai hoc nay thuoc Tuan {lesson.week_number} cua Khoa hoc '{roadmap_title}'. "
        "Dam bao content_markdown la markdown thuan, khong bao quanh bang code fence."
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


def _is_generation_output_truncated(generation_text: str, *, finish_reason: str | None) -> bool:
    content = generation_text.strip()
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

    if content.count("{") > content.count("}"):
        return True

    if content.count("[") > content.count("]"):
        return True

    return False


def _build_continuation_prompt(*, original_prompt: str, partial_output: str) -> str:
    return (
        "Dau ra JSON dang bi cat giua chung. "
        "Hay tra lai TOAN BO ket qua duoi dang 1 JSON object hop le voi dung 2 key: content_markdown va youtube_search_query. "
        "Khong chen bat ky van ban nao ngoai JSON.\n\n"
        "[Yeu cau ban dau]\n"
        f"{original_prompt}\n\n"
        "[Dau ra bi cat]\n"
        f"{partial_output[-8000:]}"
    )


def _sanitize_json_payload_text(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if not text:
        raise ValueError("Empty generation output")

    code_fence_match = JSON_CODE_FENCE_PATTERN.search(text)
    if code_fence_match:
        text = code_fence_match.group(1).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]

    return text


def parse_lesson_generation_output(raw_text: str) -> tuple[str, str]:
    cleaned = _sanitize_json_payload_text(raw_text)
    payload = json.loads(cleaned)

    if not isinstance(payload, dict):
        raise ValueError("Generation payload must be a JSON object")

    content_markdown = payload.get("content_markdown")
    youtube_search_query = payload.get("youtube_search_query")

    if not isinstance(content_markdown, str) or not content_markdown.strip():
        raise ValueError("content_markdown is required")

    if not isinstance(youtube_search_query, str) or not youtube_search_query.strip():
        raise ValueError("youtube_search_query is required")

    normalized_query = _collapse_whitespace(youtube_search_query)[:300]
    if not normalized_query:
        raise ValueError("youtube_search_query is empty")

    return content_markdown.strip(), normalized_query


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

            generation_text = _extract_gemini_text(response_payload)
            if generation_text:
                finish_reason = _extract_finish_reason(response_payload)
                if _is_generation_output_truncated(generation_text, finish_reason=finish_reason):
                    logger.warning(
                        "lesson.llm_detected_truncation model=%s finish_reason=%s",
                        model_name,
                        finish_reason,
                    )
                    continuation_payload = {
                        "contents": [
                            {
                                "role": "user",
                                "parts": [{"text": _build_continuation_prompt(original_prompt=prompt, partial_output=generation_text)}],
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
                                generation_text = continuation_text
                    except Exception as exc:
                        logger.warning(
                            "lesson.llm_continuation_failed model=%s error=%s",
                            model_name,
                            str(exc),
                        )

                if index > 0:
                    logger.warning("lesson.llm_fallback_success model=%s", model_name)
                return generation_text

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
        "videoDuration": "medium",
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
    llm_output = generate_lesson_markdown(prompt=prompt)
    youtube_query = enrich_youtube_query_with_context(
        query=build_youtube_search_query(lesson=lesson),
        lesson=lesson,
        roadmap=roadmap,
    )

    try:
        markdown, ai_youtube_query = parse_lesson_generation_output(llm_output)
        youtube_query = enrich_youtube_query_with_context(
            query=ai_youtube_query,
            lesson=lesson,
            roadmap=roadmap,
        )
    except Exception as exc:
        logger.warning(
            "lesson.llm_output_parse_failed lesson_id=%s title=%s error=%s",
            lesson.id,
            lesson.title,
            str(exc),
        )
        markdown = llm_output.strip()

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

            total_exp = get_total_exp(locked_user)
            current_streak = get_current_streak(locked_user)
            level = (total_exp // 1000) + 1

            return LessonCompleteResponseDTO(
                lesson_id=lesson_id,
                exp_gained=0,
                streak_bonus_exp=0,
                total_exp=total_exp,
                level=level,
                current_streak=current_streak,
                already_completed=True,
                message="Lesson already completed",
            )

        lesson.is_completed = True
        lesson.completed_at = datetime.now(UTC)

        streak_bonus_exp = update_study_streak(locked_user)
        exp_gained = add_exp_and_check_level(locked_user, reward_exp)

        reward_entry = ExpLedger(
            user_id=user_id,
            lesson_id=lesson_id,
            quiz_id=None,
            reward_type=LESSON_COMPLETE_REWARD_TYPE,
            exp_amount=exp_gained,
            metadata_json={"source": LESSON_COMPLETE_REWARD_TYPE},
        )

        db.add(reward_entry)

        if streak_bonus_exp > 0:
            add_exp_and_check_level(locked_user, streak_bonus_exp)
            streak_reward_entry = ExpLedger(
                user_id=user_id,
                lesson_id=lesson_id,
                quiz_id=None,
                reward_type=STREAK_BONUS_REWARD_TYPE,
                exp_amount=streak_bonus_exp,
                metadata_json={
                    "source": STREAK_BONUS_REWARD_TYPE,
                    "streak": locked_user.current_streak,
                },
            )
            db.add(streak_reward_entry)

        db.commit()
        db.refresh(locked_user)

        total_exp = get_total_exp(locked_user)
        current_streak = get_current_streak(locked_user)

        return LessonCompleteResponseDTO(
            lesson_id=lesson_id,
            exp_gained=exp_gained,
            streak_bonus_exp=streak_bonus_exp,
            total_exp=total_exp,
            level=locked_user.level,
            current_streak=current_streak,
            already_completed=False,
            message="Thanh cong",
        )
    except AppException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise AppException(status_code=409, message="Lesson completion failed", detail={"code": "LESSON_COMPLETE_FAILED", "error": str(exc)}) from exc
