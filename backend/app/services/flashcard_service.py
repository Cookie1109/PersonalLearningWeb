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
    markdown_content = (lesson.content_markdown or "").strip()
    if markdown_content:
        return markdown_content

    source_content = (lesson.source_content or "").strip()
    if source_content:
        return source_content

    raise AppException(
        status_code=400,
        message="Document has no source content for flashcards",
        detail={"code": "DOCUMENT_SOURCE_EMPTY"},
    )


def generate_flashcards_for_document_user(*, db: Session, user_id: int, document_id: int) -> list[Flashcard]:
    flashcards: list[Flashcard] = []
    transaction = db.begin_nested() if db.in_transaction() else db.begin()

    try:
        with transaction:
            lesson = _get_owned_document(db=db, user_id=user_id, document_id=document_id)
            document_text = _get_document_text_for_flashcards(lesson)
            _, generated_cards = generate_flashcards(
                lesson_title=lesson.title,
                document_text=document_text,
            )

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
            db.flush()

            # Pre-create FSRSCard records for each flashcard
            from app.models.fsrs_graph_models import FSRSCard
            from datetime import datetime, timezone
            fsrs_cards = [
                FSRSCard(
                    card_id=card.id,
                    state=1, # fsrs.State.Learning
                    step=0,
                    stability=None,
                    difficulty=None,
                    due=datetime.now(timezone.utc),
                    last_review=None
                )
                for card in flashcards
            ]
            db.add_all(fsrs_cards)
            db.flush()

            # Link concepts/tags to these new flashcards
            # First, ensure the lesson has concept tags extracted (self-healing for lessons
            # where keyword extraction has not run yet or ran before flashcards were ready)
            from app.models.fsrs_graph_models import LessonTag
            from app.services.keyword_extraction_service import (
                tag_flashcards_with_concepts,
                extract_concepts_from_text,
                save_concepts_and_edges,
            )
            stmt_check = select(LessonTag.tag_id).where(LessonTag.lesson_id == lesson.id).limit(1)
            has_tags = db.scalar(stmt_check) is not None
            if not has_tags:
                # Lesson has no concept tags yet — extract & save within current transaction
                text_source = (lesson.content_markdown or lesson.source_content or "").strip()
                if text_source:
                    concept_data = extract_concepts_from_text(lesson_title=lesson.title, text=text_source)
                    if concept_data and concept_data.get("tags"):
                        save_concepts_and_edges(db=db, user_id=user_id, lesson_id=lesson.id, data=concept_data)

            tag_flashcards_with_concepts(db=db, user_id=user_id, lesson_id=lesson.id)
            db.flush()

            # Recalculate concept weakness for this lesson's tags
            from app.models.fsrs_graph_models import LessonTag, ConceptWeakness
            from app.services.concept_aggregation import recalculate_concept_weakness
            stmt_tags = select(LessonTag.tag_id).where(LessonTag.lesson_id == lesson.id)
            tag_ids = db.scalars(stmt_tags).all()
            for tag_id in tag_ids:
                recalculate_concept_weakness(db, user_id, tag_id)

        for card in flashcards:
            db.refresh(card)

        return flashcards
    except AppException:
        raise
    except Exception as exc:
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


def update_flashcard_status_for_user(*, db: Session, card: Flashcard, status_value: str) -> Flashcard:
    normalized_status = (status_value or "").strip().lower()
    if normalized_status not in {"got_it", "missed_it", "new"}:
        raise AppException(
            status_code=400,
            message="Invalid flashcard status",
            detail={"code": "FLASHCARD_STATUS_INVALID"},
        )

    card.status = normalized_status
    db.commit()
    db.refresh(card)
    return card


def explain_flashcard_text(*, front_text: str, back_text: str) -> str:
    explanation = generate_chat_reply(
        messages=[
            {
                "role": "user",
                "content": (
                    "Giải thích trực diện và chuyên sâu khái niệm sau dưới dạng gạch đầu dòng Markdown: "
                    f"{front_text} - {back_text}"
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


def explain_flashcard_for_user(*, db: Session, card: Flashcard) -> str:
    return explain_flashcard_text(front_text=card.front_text, back_text=card.back_text)
