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
from app.models import ExpLedger, FlashcardProgress, Lesson, Quiz, QuizAttempt, Roadmap, User
from app.schemas import DocumentSummaryDTO, FlashcardCompleteResponseDTO, LessonCompleteResponseDTO, LessonDetailDTO
from app.services.gamification_service import add_exp_and_check_level, get_current_streak, get_total_exp, update_study_streak

LESSON_COMPLETE_REWARD_TYPE = "lesson_complete"
STREAK_BONUS_REWARD_TYPE = "streak_bonus"
logger = logging.getLogger("app.lesson")


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


def _fallback_theory_markdown(*, title: str, source_content: str) -> str:
    cleaned = source_content.strip()
    if not cleaned:
        return f"## {title}\n\nTai lieu goc dang trong."

    chunks = [chunk.strip() for chunk in re.split(r"\n\s*\n", cleaned) if chunk.strip()]
    if not chunks:
        chunks = [cleaned]

    lines = [f"## {title}", "", "### Tom tat tu tai lieu goc", ""]
    for chunk in chunks[:10]:
        lines.append(f"- {chunk[:400]}")

    return "\n".join(lines).strip()


def build_document_theory_prompt(*, title: str, source_content: str) -> str:
    bounded_source = source_content.strip()[:40000]

    return (
        "Ban la mot tro ly hoc tap theo mo hinh NotebookLM mini. "
        "Nguon su that DUY NHAT la tai lieu goc ben duoi. "
        "TUYET DOI KHONG bo sung kien thuc ben ngoai tai lieu goc, KHONG suy dien, KHONG phong doan. "
        "Moi nhan dinh, so lieu, vi du, ma lenh deu phai truy vet duoc tu tai lieu goc. "
        "Neu tai lieu goc khong de cap, phai ghi ro nguyen van: 'Tai lieu goc khong de cap'. "
        "Dau ra bat buoc la Markdown GFM hop le (khong JSON). "
        "Duoc phep va khuyen khich dung code fence ```lang``` khi tai lieu co code/command; "
        "duoc phep dung bang Markdown khi co du lieu doi chieu. "
        "Khong duoc dat toan bo cau tra loi trong mot code fence duy nhat. "
        "Cau truc bat buoc: 1) Muc tieu tai lieu, 2) Khai niem then chot, 3) Quy trinh/thao tac (neu co), "
        "4) Thong so/ghi chu quan trong (neu co), 5) Tong ket ngan. "
        "Su dung heading ro rang, bullet ngan gon, va chi trinh bay noi dung co trong tai lieu.\n\n"
        f"Tieu de tai lieu: {title.strip()}\n\n"
        "Tai lieu goc (nguon su that duy nhat):\n"
        f"{bounded_source}"
    )


def _build_unique_document_title(*, db: Session, user_id: int, preferred_title: str) -> str:
    base_title = _collapse_whitespace(preferred_title.strip())[:255]
    if not base_title:
        base_title = f"Tai lieu moi - {datetime.now(UTC).strftime('%d/%m/%Y')}"

    candidate = base_title
    counter = 2
    while True:
        existing_id = db.scalar(
            select(Lesson.id).where(
                and_(
                    Lesson.user_id == user_id,
                    Lesson.title == candidate,
                )
            )
        )
        if existing_id is None:
            return candidate

        suffix = f" ({counter})"
        trimmed_base = base_title[: max(1, 255 - len(suffix))].rstrip()
        candidate = f"{trimmed_base}{suffix}"
        counter += 1


def create_document_for_user(
    *,
    db: Session,
    user_id: int,
    title: str,
    source_content: str,
) -> Lesson:
    normalized_title = _build_unique_document_title(db=db, user_id=user_id, preferred_title=title)
    normalized_source = source_content.strip()
    if not normalized_source:
        raise AppException(status_code=409, message="Document source is empty", detail={"code": "DOCUMENT_SOURCE_EMPTY"})

    theory_markdown = ""
    try:
        theory_markdown = generate_grounded_markdown(
            prompt=build_document_theory_prompt(title=normalized_title, source_content=normalized_source)
        ).strip()
    except AppException as exc:
        logger.warning("document.create_theory_llm_failed title=%s error=%s", normalized_title, str(exc))
    except Exception as exc:
        logger.warning("document.create_theory_llm_unexpected_error title=%s error=%s", normalized_title, str(exc))

    if not theory_markdown:
        theory_markdown = _fallback_theory_markdown(title=normalized_title, source_content=normalized_source)

    try:
        lesson = Lesson(
            user_id=user_id,
            roadmap_id=None,
            week_number=1,
            position=1,
            title=normalized_title,
            source_content=normalized_source,
            content_markdown=theory_markdown,
            youtube_video_id=None,
            version=1,
            is_completed=False,
        )
        db.add(lesson)
        db.commit()
        db.refresh(lesson)
        return lesson
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=409,
            message="Document creation failed",
            detail={"code": "DOCUMENT_CREATE_FAILED", "error": str(exc)},
        ) from exc


def list_documents_for_user(*, db: Session, user_id: int) -> list[DocumentSummaryDTO]:
    lessons = list(
        db.scalars(
            select(Lesson)
            .where(Lesson.user_id == user_id)
            .order_by(Lesson.created_at.desc(), Lesson.id.desc())
        )
    )

    progress_map = get_lesson_sub_indicators_for_user(
        db=db,
        user_id=user_id,
        lesson_ids=[lesson.id for lesson in lessons],
    )

    return [
        DocumentSummaryDTO(
            id=lesson.id,
            title=lesson.title,
            is_completed=lesson.is_completed,
            quiz_passed=progress_map.get(lesson.id, (False, False))[0],
            flashcard_completed=progress_map.get(lesson.id, (False, False))[1],
            created_at=lesson.created_at,
        )
        for lesson in lessons
    ]


def get_lesson_sub_indicators_for_user(
    *,
    db: Session,
    user_id: int,
    lesson_ids: list[int],
) -> dict[int, tuple[bool, bool]]:
    normalized_ids = sorted({int(lesson_id) for lesson_id in lesson_ids if lesson_id})
    if not normalized_ids:
        return {}

    quiz_passed_ids = set(
        db.scalars(
            select(Quiz.lesson_id)
            .join(QuizAttempt, QuizAttempt.quiz_id == Quiz.id)
            .where(
                and_(
                    QuizAttempt.user_id == user_id,
                    QuizAttempt.passed.is_(True),
                    Quiz.lesson_id.in_(normalized_ids),
                )
            )
            .distinct()
        )
    )

    flashcard_completed_ids = set(
        db.scalars(
            select(FlashcardProgress.lesson_id).where(
                and_(
                    FlashcardProgress.user_id == user_id,
                    FlashcardProgress.lesson_id.in_(normalized_ids),
                )
            )
        )
    )

    return {
        lesson_id: (
            lesson_id in quiz_passed_ids,
            lesson_id in flashcard_completed_ids,
        )
        for lesson_id in normalized_ids
    }


def _to_lesson_detail(
    lesson: Lesson,
    roadmap: Roadmap | None,
    *,
    quiz_passed: bool = False,
    flashcard_completed: bool = False,
) -> LessonDetailDTO:
    content = lesson.content_markdown.strip() if lesson.content_markdown else None
    if roadmap is not None:
        roadmap_id = roadmap.id
        roadmap_title = roadmap.title or roadmap.goal
    else:
        roadmap_id = None
        roadmap_title = None

    return LessonDetailDTO(
        id=lesson.id,
        title=lesson.title,
        week_number=lesson.week_number,
        position=lesson.position,
        roadmap_id=roadmap_id,
        roadmap_title=roadmap_title,
        is_completed=lesson.is_completed,
        quiz_passed=quiz_passed,
        flashcard_completed=flashcard_completed,
        source_content=lesson.source_content,
        content_markdown=content,
        youtube_video_id=lesson.youtube_video_id,
        is_draft=not bool(content),
    )


def _get_owned_lesson(*, db: Session, user_id: int, lesson_id: int, lock: bool = False) -> Lesson:
    stmt = select(Lesson).where(and_(Lesson.id == lesson_id, Lesson.user_id == user_id))
    if lock:
        stmt = stmt.with_for_update()

    lesson = db.scalar(stmt)

    if lesson is None:
        raise AppException(status_code=404, message="Lesson not found", detail={"code": "LESSON_NOT_FOUND"})

    return lesson


def _get_optional_roadmap_context(*, db: Session, lesson: Lesson) -> Roadmap | None:
    if lesson.roadmap_id is None:
        return None

    return db.get(Roadmap, lesson.roadmap_id)


def get_lesson_for_user(*, db: Session, user_id: int, lesson_id: int) -> tuple[Lesson, Roadmap | None]:
    lesson = _get_owned_lesson(db=db, user_id=user_id, lesson_id=lesson_id)
    roadmap = _get_optional_roadmap_context(db=db, lesson=lesson)

    if roadmap is not None and roadmap.user_id != user_id:
        raise AppException(status_code=404, message="Lesson not found", detail={"code": "LESSON_NOT_FOUND"})

    return lesson, roadmap


def get_lesson_detail_for_user(*, db: Session, user_id: int, lesson_id: int) -> LessonDetailDTO:
    lesson, roadmap = get_lesson_for_user(db=db, user_id=user_id, lesson_id=lesson_id)
    progress_map = get_lesson_sub_indicators_for_user(db=db, user_id=user_id, lesson_ids=[lesson.id])
    quiz_passed, flashcard_completed = progress_map.get(lesson.id, (False, False))
    return _to_lesson_detail(
        lesson,
        roadmap,
        quiz_passed=quiz_passed,
        flashcard_completed=flashcard_completed,
    )


def mark_flashcard_completed_for_user(
    *,
    db: Session,
    user_id: int,
    lesson_id: int,
) -> FlashcardCompleteResponseDTO:
    _get_owned_lesson(db=db, user_id=user_id, lesson_id=lesson_id)

    existing_progress = db.scalar(
        select(FlashcardProgress).where(
            and_(
                FlashcardProgress.user_id == user_id,
                FlashcardProgress.lesson_id == lesson_id,
            )
        )
    )
    if existing_progress is not None:
        return FlashcardCompleteResponseDTO(
            lesson_id=lesson_id,
            flashcard_completed=True,
            already_completed=True,
            message="Flashcard already completed",
        )

    try:
        db.add(FlashcardProgress(user_id=user_id, lesson_id=lesson_id))
        db.commit()
        return FlashcardCompleteResponseDTO(
            lesson_id=lesson_id,
            flashcard_completed=True,
            already_completed=False,
            message="Thanh cong",
        )
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=409,
            message="Flashcard completion failed",
            detail={"code": "FLASHCARD_COMPLETE_FAILED", "error": str(exc)},
        ) from exc


def get_lesson_for_generation(*, db: Session, user_id: int, lesson_id: int) -> tuple[Lesson, Roadmap | None]:
    lesson = _get_owned_lesson(db=db, user_id=user_id, lesson_id=lesson_id)

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


def generate_grounded_markdown(*, prompt: str) -> str:
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
            "temperature": 0.2,
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
                if has_fallback:
                    continue
                raise AppException(status_code=503, message="AI service timeout", detail={"code": "LLM_TIMEOUT"}) from exc
            except httpx.RequestError as exc:
                if has_fallback:
                    continue
                raise AppException(status_code=503, message="AI service network error", detail={"code": "LLM_NETWORK_ERROR"}) from exc

            if response.status_code in (401, 403):
                raise AppException(
                    status_code=503,
                    message="AI service authentication failed",
                    detail={"code": "LLM_AUTH_FAILED"},
                )

            if response.status_code >= 400:
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
                if has_fallback:
                    continue
                raise AppException(
                    status_code=503,
                    message="AI service returned invalid response",
                    detail={"code": "LLM_INVALID_RESPONSE"},
                ) from exc

            generation_text = _extract_gemini_text(response_payload).strip()
            if generation_text:
                return generation_text

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


def generate_lesson_content_for_user(*, db: Session, user_id: int, lesson_id: int) -> LessonDetailDTO:
    lesson, roadmap = get_lesson_for_generation(db=db, user_id=user_id, lesson_id=lesson_id)

    source_content = (lesson.source_content or "").strip()
    if not source_content:
        raise AppException(
            status_code=409,
            message="Document source content is empty",
            detail={"code": "LESSON_SOURCE_EMPTY"},
        )

    markdown = ""
    try:
        markdown = generate_grounded_markdown(
            prompt=build_document_theory_prompt(title=lesson.title, source_content=source_content)
        ).strip()
    except AppException as exc:
        logger.warning("lesson.grounded_theory_generation_failed lesson_id=%s error=%s", lesson.id, str(exc))

    if not markdown:
        markdown = _fallback_theory_markdown(title=lesson.title, source_content=source_content)

    try:
        lesson.content_markdown = markdown
        lesson.youtube_video_id = None
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

    progress_map = get_lesson_sub_indicators_for_user(db=db, user_id=user_id, lesson_ids=[lesson.id])
    quiz_passed, flashcard_completed = progress_map.get(lesson.id, (False, False))
    return _to_lesson_detail(
        lesson,
        roadmap,
        quiz_passed=quiz_passed,
        flashcard_completed=flashcard_completed,
    )


def complete_lesson_for_user(
    *,
    db: Session,
    user_id: int,
    lesson_id: int,
    reward_exp: int,
) -> LessonCompleteResponseDTO:
    lesson = _get_owned_lesson(db=db, user_id=user_id, lesson_id=lesson_id)

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
