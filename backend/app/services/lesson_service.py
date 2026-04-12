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


def _build_lesson_model_candidates(settings) -> list[str]:
    configured_pro_model = (settings.gemini_pro_model or "").strip() or "gemini-1.5-pro"
    configured_flash_model = (settings.gemini_model or "").strip() or "gemini-2.5-flash"

    stable_fallbacks = (
        "gemini-flash-lite-latest",
        "gemini-flash-latest",
        "gemini-2.0-flash-lite",
        "gemini-2.0-flash-lite-001",
        "gemini-2.0-flash",
        "gemini-2.5-flash",
    )

    candidates: list[str] = []
    for candidate in (
        configured_pro_model,
        _normalize_model_name(configured_pro_model),
        configured_flash_model,
        _normalize_model_name(configured_flash_model),
        *stable_fallbacks,
    ):
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    return candidates


def build_document_theory_prompt(*, title: str, source_content: str) -> str:
    full_source = source_content.strip()

    return (
        "Bạn là một Chuyên gia Viết sách Kỹ thuật và Giảng viên IT xuất sắc. "
        "Bạn nhận được văn bản thô được cào từ website hoặc tài liệu. "
        "Nhiệm vụ của bạn là thực hiện quy trình \"Chắt lọc Sư phạm\" gồm 4 bước bắt buộc sau để tạo ra một bài giảng Markdown hoàn hảo:\n\n"
        "BƯỚC 1: LỌC NHIỄU (NOISE REDUCTION)\n"
        "- Đọc lướt toàn bộ văn bản. Nhận diện và XÓA BỎ NGAY LẬP TỨC: Các câu \"Bài trước\", \"Bài sau\", \"Mục lục\", lời chào hỏi đầu/cuối bài, text quảng cáo, ghi chú tác giả, và các đoạn trắc nghiệm/bài tập có sẵn. CHỈ GIỮ LẠI nội dung lý thuyết và thực hành cốt lõi.\n\n"
        "BƯỚC 2: TÁI CẤU TRÚC (RESTRUCTURING)\n"
        "- Gom nhóm các ý có liên quan lại với nhau. Đặt Tiêu đề phụ (Heading 3: ###) cho từng phần để tạo bộ khung rõ ràng.\n"
        "- TUYỆT ĐỐI KHÔNG viết đoạn văn dài quá 4 dòng. Sử dụng linh hoạt danh sách gạch đầu dòng (-) để liệt kê các tính năng, khái niệm.\n\n"
        "BƯỚC 3: BẢO TOÀN KỸ THUẬT (TECHNICAL PRESERVATION) - RẤT QUAN TRỌNG\n"
        "- Bạn phải trích xuất ĐẦY ĐỦ 100% các câu lệnh (command line), mã nguồn (code) và kết quả Terminal có trong bài gốc.\n"
        "- BẮT BUỘC bọc tất cả chúng trong Markdown Code Block ( ```ngôn ngữ...``` ). Ví dụ kết quả bảng SQL thì bọc trong ```text hoặc ```sql. Tuyệt đối không để code nằm lẫn với văn bản thường.\n\n"
        "BƯỚC 4: ĐỊNH DẠNG HIỂN THỊ (WHITESPACE FORMATTING)\n"
        "- Đảm bảo luôn có 2 DẤU XUỐNG DÒNG (\\n\\n) ngăn cách giữa các đoạn văn và giữa đoạn văn với Code Block.\n\n"
        "QUY TẮC CỐT LÕI: Chỉ dùng thông tin từ văn bản gốc, tuyệt đối không bịa đặt thêm kiến thức ngoài.\n\n"
        f"Tiêu đề tài liệu: {title.strip()}\n\n"
        "Tài liệu gốc (nguồn sự thật duy nhất):\n"
        f"{full_source}"
    )


def _raise_theory_ai_failure(*, scope: str, exc: Exception) -> None:
    if isinstance(exc, AppException):
        logger.error(
            "%s upstream_status=%s upstream_detail=%s message=%s",
            scope,
            exc.status_code,
            exc.detail,
            exc.message,
            exc_info=True,
        )
        raise AppException(
            status_code=500,
            message=f"He thong AI gap loi: {exc.message}",
            detail={
                "code": "THEORY_AI_FAILED",
                "upstream_status": exc.status_code,
                "upstream_code": exc.detail.get("code") if isinstance(exc.detail, dict) else None,
            },
        ) from exc

    logger.error("%s unexpected_error=%s", scope, str(exc), exc_info=True)
    raise AppException(
        status_code=500,
        message=f"He thong AI gap loi: {str(exc)}",
        detail={"code": "THEORY_AI_FAILED"},
    ) from exc


def _build_unique_document_title(*, db: Session, user_id: int, preferred_title: str) -> str:
    base_title = _collapse_whitespace(preferred_title.strip())[:255]
    if not base_title:
        base_title = f"Tài liệu moi - {datetime.now(UTC).strftime('%d/%m/%Y')}"

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

    try:
        theory_markdown = generate_grounded_markdown(
            prompt=build_document_theory_prompt(title=normalized_title, source_content=normalized_source)
        ).strip()
    except Exception as exc:
        _raise_theory_ai_failure(scope=f"document.create_theory_failed title={normalized_title}", exc=exc)

    if not theory_markdown:
        raise AppException(
            status_code=500,
            message="He thong AI gap loi: AI service returned empty response",
            detail={"code": "THEORY_AI_EMPTY_RESPONSE"},
        )

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
        _to_document_summary(lesson=lesson, progress_map=progress_map)
        for lesson in lessons
    ]


def _to_document_summary(*, lesson: Lesson, progress_map: dict[int, tuple[bool, bool]]) -> DocumentSummaryDTO:
    quiz_passed, flashcard_completed = progress_map.get(lesson.id, (False, False))
    return DocumentSummaryDTO(
        id=lesson.id,
        title=lesson.title,
        is_completed=lesson.is_completed,
        quiz_passed=quiz_passed,
        flashcard_completed=flashcard_completed,
        created_at=lesson.created_at,
    )


def _normalize_document_title_for_update(raw_title: str) -> str:
    normalized = _collapse_whitespace(raw_title.strip())[:255]
    if len(normalized) < 3:
        raise AppException(
            status_code=409,
            message="Document title must be at least 3 characters",
            detail={"code": "DOCUMENT_TITLE_TOO_SHORT"},
        )
    return normalized


def rename_document_for_user(*, db: Session, user_id: int, lesson_id: int, title: str) -> DocumentSummaryDTO:
    normalized_title = _normalize_document_title_for_update(title)

    try:
        lesson = _get_owned_lesson(db=db, user_id=user_id, lesson_id=lesson_id, lock=True)

        duplicate_lesson_id = db.scalar(
            select(Lesson.id).where(
                and_(
                    Lesson.user_id == user_id,
                    Lesson.id != lesson.id,
                    Lesson.title == normalized_title,
                )
            )
        )
        if duplicate_lesson_id is not None:
            raise AppException(
                status_code=409,
                message="Document title already exists",
                detail={"code": "DOCUMENT_TITLE_CONFLICT"},
            )

        if lesson.title != normalized_title:
            lesson.title = normalized_title
            lesson.version = (lesson.version or 1) + 1
            db.commit()
            db.refresh(lesson)
        else:
            db.commit()
            db.refresh(lesson)

        progress_map = get_lesson_sub_indicators_for_user(db=db, user_id=user_id, lesson_ids=[lesson.id])
        return _to_document_summary(lesson=lesson, progress_map=progress_map)
    except AppException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=409,
            message="Document rename failed",
            detail={"code": "DOCUMENT_RENAME_FAILED", "error": str(exc)},
        ) from exc


def delete_document_for_user(*, db: Session, user_id: int, lesson_id: int) -> None:
    try:
        lesson = _get_owned_lesson(db=db, user_id=user_id, lesson_id=lesson_id, lock=True)
        db.delete(lesson)
        db.commit()
    except AppException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=409,
            message="Document delete failed",
            detail={"code": "DOCUMENT_DELETE_FAILED", "error": str(exc)},
        ) from exc


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


def _extract_finish_reason(payload: dict[str, Any]) -> str | None:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return None

    first_candidate = candidates[0]
    if not isinstance(first_candidate, dict):
        return None

    reason = first_candidate.get("finishReason")
    return reason if isinstance(reason, str) else None


def _is_markdown_truncated(markdown: str, *, finish_reason: str | None) -> bool:
    content = (markdown or "").strip()
    if not content:
        return True

    if finish_reason == "MAX_TOKENS":
        return True

    lines = [line.rstrip() for line in content.splitlines() if line.strip()]
    if not lines:
        return True

    last_line = lines[-1]
    if INCOMPLETE_TRAILING_PATTERN.search(last_line):
        return True
    if re.match(r"^#{1,6}\s*$", last_line):
        return True
    if re.match(r"^\*\*[^*]*$", last_line):
        return True

    if content.count("```") % 2 != 0:
        return True

    return False


def _build_theory_continuation_prompt(*, partial_markdown: str) -> str:
    return (
        "Nội dung lý thuyết ban vua tra loi đang bi cat giua chung. "
        "Hay viet tiep PHAN CON LAI bang Markdown, KHONG lap lai nội dung da co, "
        "giu nguyen câu truc heading/list/code block, va ket thuc day du.\n\n"
        "[NOI DUNG DA CO]\n"
        f"{partial_markdown[-7000:]}"
    )


def _extend_truncated_markdown(
    *,
    client: httpx.Client,
    endpoint: str,
    api_key: str,
    prompt: str,
    initial_markdown: str,
    initial_finish_reason: str | None,
) -> str:
    combined = (initial_markdown or "").strip()
    finish_reason = initial_finish_reason

    if not _is_markdown_truncated(combined, finish_reason=finish_reason):
        return combined

    logger.warning("lesson.llm_detected_truncation finish_reason=%s", finish_reason)

    for _ in range(2):
        continuation_payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                },
                {
                    "role": "model",
                    "parts": [{"text": combined}],
                },
                {
                    "role": "user",
                    "parts": [{"text": _build_theory_continuation_prompt(partial_markdown=combined)}],
                },
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 4096,
            },
        }

        try:
            continuation_response = client.post(endpoint, params={"key": api_key}, json=continuation_payload)
        except Exception as exc:  # pragma: no cover - defensive for transport-level issues
            logger.warning("lesson.llm_continuation_request_failed error=%s", str(exc))
            break

        if continuation_response.status_code >= 400:
            logger.warning(
                "lesson.llm_continuation_failed status=%s error=%s",
                continuation_response.status_code,
                _extract_llm_error_message(continuation_response),
            )
            break

        try:
            continuation_payload_json = continuation_response.json()
        except ValueError:
            logger.warning("lesson.llm_continuation_invalid_json")
            break

        continuation_text = _extract_gemini_text(continuation_payload_json).strip()
        if not continuation_text:
            break

        combined = f"{combined.rstrip()}\n\n{continuation_text.lstrip()}"
        finish_reason = _extract_finish_reason(continuation_payload_json)
        if not _is_markdown_truncated(combined, finish_reason=finish_reason):
            break

    return combined


def _extract_llm_error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return (response.text or "").strip()[:500] or "Unknown AI service error"

    if isinstance(payload, dict):
        error_block = payload.get("error")
        if isinstance(error_block, dict):
            message = error_block.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()[:500]
        return str(payload)[:500]

    return str(payload)[:500]


def _build_gemini_payload(*, prompt: str, max_output_tokens: int) -> dict[str, Any]:
    return {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": max_output_tokens,
        },
    }


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
    max_output_tokens = 8192
    retry_max_output_tokens = 4096

    with httpx.Client(timeout=timeout_seconds) as client:
        for index, model_name in enumerate(model_candidates):
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            has_fallback = index < len(model_candidates) - 1
            payload = _build_gemini_payload(prompt=prompt, max_output_tokens=max_output_tokens)

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
                    message=f"AI service authentication failed: {_extract_llm_error_message(response)}",
                    detail={"code": "LLM_AUTH_FAILED"},
                )

            if response.status_code == 400:
                error_message = _extract_llm_error_message(response)
                logger.error(
                    "lesson.llm_bad_request model=%s max_output_tokens=%s error=%s",
                    model_name,
                    max_output_tokens,
                    error_message,
                )

                if (
                    max_output_tokens > retry_max_output_tokens
                    and (
                        "maxoutputtokens" in error_message.lower()
                        or "max output" in error_message.lower()
                        or "invalid argument" in error_message.lower()
                    )
                ):
                    retry_payload = _build_gemini_payload(prompt=prompt, max_output_tokens=retry_max_output_tokens)
                    retry_response = client.post(endpoint, params={"key": api_key}, json=retry_payload)
                    if retry_response.status_code < 400:
                        try:
                            retry_payload_json = retry_response.json()
                        except ValueError as exc:
                            raise AppException(
                                status_code=503,
                                message="AI service returned invalid response",
                                detail={"code": "LLM_INVALID_RESPONSE"},
                            ) from exc

                        generation_text = _extract_gemini_text(retry_payload_json).strip()
                        if generation_text:
                            finish_reason = _extract_finish_reason(retry_payload_json)
                            return _extend_truncated_markdown(
                                client=client,
                                endpoint=endpoint,
                                api_key=api_key,
                                prompt=prompt,
                                initial_markdown=generation_text,
                                initial_finish_reason=finish_reason,
                            )
                        raise AppException(
                            status_code=503,
                            message="AI service returned empty response",
                            detail={"code": "LLM_EMPTY_RESPONSE"},
                        )

                    retry_error_message = _extract_llm_error_message(retry_response)
                    logger.error(
                        "lesson.llm_bad_request_retry_failed model=%s max_output_tokens=%s error=%s",
                        model_name,
                        retry_max_output_tokens,
                        retry_error_message,
                    )

                raise AppException(
                    status_code=503,
                    message=f"AI service bad request: {error_message}",
                    detail={"code": "LLM_BAD_REQUEST"},
                )

            if response.status_code >= 400:
                error_message = _extract_llm_error_message(response)
                logger.error(
                    "lesson.llm_service_error model=%s status=%s error=%s",
                    model_name,
                    response.status_code,
                    error_message,
                )
                if has_fallback and response.status_code in (404, 429, 500, 503):
                    continue
                raise AppException(
                    status_code=503,
                    message=f"AI service unavailable: {error_message}",
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
                finish_reason = _extract_finish_reason(response_payload)
                return _extend_truncated_markdown(
                    client=client,
                    endpoint=endpoint,
                    api_key=api_key,
                    prompt=prompt,
                    initial_markdown=generation_text,
                    initial_finish_reason=finish_reason,
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


def generate_lesson_content_for_user(*, db: Session, user_id: int, lesson_id: int) -> LessonDetailDTO:
    lesson, roadmap = get_lesson_for_generation(db=db, user_id=user_id, lesson_id=lesson_id)

    source_content = (lesson.source_content or "").strip()
    if not source_content:
        raise AppException(
            status_code=409,
            message="Document source content is empty",
            detail={"code": "LESSON_SOURCE_EMPTY"},
        )

    try:
        markdown = generate_grounded_markdown(
            prompt=build_document_theory_prompt(title=lesson.title, source_content=source_content)
        ).strip()
    except Exception as exc:
        _raise_theory_ai_failure(scope=f"lesson.generate_theory_failed lesson_id={lesson.id}", exc=exc)

    if not markdown:
        raise AppException(
            status_code=500,
            message="He thong AI gap loi: AI service returned empty response",
            detail={"code": "THEORY_AI_EMPTY_RESPONSE"},
        )

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

