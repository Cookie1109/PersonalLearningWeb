from __future__ import annotations

import re

from sqlalchemy import and_, delete, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.models import Flashcard, Lesson
from app.services.chat_service import generate_chat_reply
from app.services.flashcard_generation_service import generate_flashcards

FLASHCARD_EXPLAIN_SYSTEM_PROMPT = (
    "Quy tắc bắt buộc: Giải thích khái niệm này một cách trực diện, ngắn gọn và chuyên sâu. "
    "Sử dụng văn phong học thuật, khách quan dành cho sinh viên đại học hoặc người đi làm. "
    "Tuyệt đối không xưng hô, không chào hỏi, và không sử dụng các ví dụ trẻ con/trẻ mầm non. "
    "Trình bày nội dung dưới dạng gạch đầu dòng Markdown rõ ràng."
)
FLASHCARD_EXPLAIN_GREETING_PATTERN = re.compile(
    r"(?i)\b(chào|chao)\s+(các em|cac em)\b[,:!\-\s]*"
)


def _sanitize_flashcard_explanation_output(explanation: str) -> str:
    normalized = (explanation or "").strip()
    if not normalized:
        return ""

    normalized = FLASHCARD_EXPLAIN_GREETING_PATTERN.sub("", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def _get_owned_document(*, db: Session, user_id: int, document_id: int) -> Lesson:
    lesson = db.scalar(
        select(Lesson).where(
            and_(
                Lesson.id == document_id,
                Lesson.user_id == user_id,
            )
        )
    )
    if lesson is None:
        raise AppException(
            status_code=404,
            message="Document not found",
            detail={"code": "DOCUMENT_NOT_FOUND"},
        )
    return lesson


def _get_document_text_for_flashcards(lesson: Lesson) -> str:
    source_content = (lesson.source_content or "").strip()
    if source_content:
        return source_content

    markdown_content = (lesson.content_markdown or "").strip()
    if markdown_content:
        return markdown_content

    raise AppException(
        status_code=400,
        message="Document has no source content for flashcards",
        detail={"code": "DOCUMENT_SOURCE_EMPTY"},
    )


def generate_flashcards_for_document_user(*, db: Session, user_id: int, document_id: int) -> list[Flashcard]:
    lesson = _get_owned_document(db=db, user_id=user_id, document_id=document_id)
    document_text = _get_document_text_for_flashcards(lesson)

    _, generated_cards = generate_flashcards(
        lesson_title=lesson.title,
        document_text=document_text,
    )

    try:
        db.execute(delete(Flashcard).where(Flashcard.document_id == lesson.id))

        flashcards = [
            Flashcard(
                document_id=lesson.id,
                front_text=item.front_text,
                back_text=item.back_text,
                status="new",
            )
            for item in generated_cards
        ]

        db.add_all(flashcards)
        db.commit()

        for card in flashcards:
            db.refresh(card)

        return flashcards
    except AppException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=500,
            message="Failed to store generated flashcards",
            detail={"code": "FLASHCARD_STORE_FAILED", "error": str(exc)},
        ) from exc


def get_flashcards_for_document_user(*, db: Session, user_id: int, document_id: int) -> list[Flashcard]:
    lesson = _get_owned_document(db=db, user_id=user_id, document_id=document_id)
    return list(
        db.scalars(
            select(Flashcard)
            .where(Flashcard.document_id == lesson.id)
            .order_by(Flashcard.id.asc())
        )
    )


def update_flashcard_status_for_user(*, db: Session, user_id: int, card_id: int, status_value: str) -> Flashcard:
    normalized_status = (status_value or "").strip().lower()
    if normalized_status not in {"got_it", "missed_it", "new"}:
        raise AppException(
            status_code=400,
            message="Invalid flashcard status",
            detail={"code": "FLASHCARD_STATUS_INVALID"},
        )

    card = db.scalar(
        select(Flashcard)
        .join(Lesson, Flashcard.document_id == Lesson.id)
        .where(
            and_(
                Flashcard.id == card_id,
                Lesson.user_id == user_id,
            )
        )
    )
    if card is None:
        raise AppException(
            status_code=404,
            message="Flashcard not found",
            detail={"code": "FLASHCARD_NOT_FOUND"},
        )

    card.status = normalized_status
    db.commit()
    db.refresh(card)
    return card


def explain_flashcard_for_user(*, db: Session, user_id: int, card_id: int) -> str:
    card = db.scalar(
        select(Flashcard)
        .join(Lesson, Flashcard.document_id == Lesson.id)
        .where(
            and_(
                Flashcard.id == card_id,
                Lesson.user_id == user_id,
            )
        )
    )
    if card is None:
        raise AppException(
            status_code=404,
            message="Flashcard not found",
            detail={"code": "FLASHCARD_NOT_FOUND"},
        )

    explanation = generate_chat_reply(
        messages=[
            {
                "role": "user",
                "content": (
                    "Giải thích trực diện và chuyên sâu khái niệm sau dưới dạng gạch đầu dòng Markdown: "
                    f"{card.front_text} - {card.back_text}"
                ),
            }
        ],
        system_prompt=FLASHCARD_EXPLAIN_SYSTEM_PROMPT,
    )

    normalized_explanation = _sanitize_flashcard_explanation_output(explanation)
    if not normalized_explanation:
        raise AppException(
            status_code=503,
            message="AI service returned empty explanation",
            detail={"code": "LLM_EMPTY_RESPONSE"},
        )

    return normalized_explanation
