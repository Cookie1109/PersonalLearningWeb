import json
import logging
import re
import httpx
from sqlalchemy.orm import Session
from sqlalchemy import select, and_, delete

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.models.lesson import Lesson
from app.models.flashcard import Flashcard
from app.models.fsrs_graph_models import ConceptTag, ConceptEdge, LessonTag, FlashcardTag, ConceptWeakness

logger = logging.getLogger("app.keyword_extraction")

KEYWORD_SYSTEM_PROMPT = """
Bạn là một chuyên gia xây dựng Đồ thị Tri thức (Knowledge Graph) phục vụ học tập.
Nhiệm vụ của bạn là đọc toàn bộ văn bản được cung cấp và trích xuất các Khái niệm cốt lõi (concept tags) và các Mối quan hệ liên kết giữa chúng (concept edges).

Quy tắc trích xuất Khái niệm (tags):
- Chỉ trích xuất các thuật ngữ học thuật, định nghĩa, chủ đề, hoặc khái niệm cốt lõi (ví dụ: "Binary Tree", "Recursion", "BST", "DFS").
- Số lượng: Trích xuất từ 5 đến 12 khái niệm quan trọng nhất. Mỗi khái niệm là danh từ hoặc cụm từ ngắn gọn, tối đa 3-4 từ.

Quy tắc trích xuất Mối quan hệ (edges):
- Trích xuất các liên kết thể hiện mối quan hệ ngữ nghĩa hoặc quan hệ phụ thuộc giữa các khái niệm đã tìm được.
- Mỗi liên kết gồm:
  + source: Tên khái niệm gốc (phải trùng khớp chính xác với một trong các tags đã trích xuất).
  + target: Tên khái niệm đích (phải trùng khớp chính xác với một trong các tags đã trích xuất).
  + weight: Trọng số thể hiện độ mạnh của mối quan hệ, giá trị thực từ 0.1 đến 1.0.
  + relationship_type: Loại mối quan hệ bằng cụm từ ngắn tiếng Anh (ví dụ: "is_a", "uses", "part_of", "depends_on", "related_to").

Đầu ra bắt buộc là định dạng JSON Object có cấu trúc chính xác như sau:
{
  "tags": ["Concept A", "Concept B", ...],
  "edges": [
    {"source": "Concept A", "target": "Concept B", "weight": 0.8, "relationship_type": "uses"},
    ...
  ]
}
""".strip()

CODE_FENCE_PATTERN = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.IGNORECASE | re.DOTALL)


def _extract_gemini_text(payload: dict) -> str:
    try:
        candidates = payload.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            return ""
        candidate = candidates[0]
        content = candidate.get("content")
        if not isinstance(content, dict):
            return ""
        parts = content.get("parts")
        if not isinstance(parts, list) or not parts:
            return ""
        
        chunks = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                chunks.append(text.strip())
        return "\n\n".join(chunks).strip()
    except Exception:
        return ""


def _extract_json_candidate_text(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if not text:
        return ""

    if text.startswith("```"):
        block_match = CODE_FENCE_PATTERN.search(text)
        if block_match:
            text = block_match.group(1).strip()

    array_start = text.find("{")
    array_end = text.rfind("}")
    if array_start != -1 and array_end != -1 and array_end > array_start:
        return text[array_start : array_end + 1]

    return text


def extract_concepts_from_text(lesson_title: str, text: str) -> dict:
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        logger.error("Gemini API Key is missing")
        return {"tags": [], "edges": []}

    model_candidates = [
        settings.gemini_model,
        "gemini-2.5-flash",
        "gemini-2.5-pro"
    ]
    timeout_seconds = max(30.0, float(settings.gemini_timeout_seconds))

    user_prompt = (
        f"INPUT SOURCE:\n"
        f"- Document title: {lesson_title}\n"
        f"- Content text:\n"
        f"{text}"
    )

    request_payload = {
        "systemInstruction": {
            "role": "user",
            "parts": [{"text": KEYWORD_SYSTEM_PROMPT}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
        },
    }

    with httpx.Client(timeout=timeout_seconds) as client:
        for model_name in model_candidates:
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            try:
                response = client.post(endpoint, params={"key": api_key}, json=request_payload)
                if response.status_code == 200:
                    res_json = response.json()
                    gen_text = _extract_gemini_text(res_json)
                    if gen_text:
                        json_text = _extract_json_candidate_text(gen_text)
                        data = json.loads(json_text)
                        if isinstance(data, dict) and "tags" in data:
                            return data
            except Exception as e:
                logger.warning("Failed to extract concepts with model %s: %s", model_name, str(e))
                continue

    # Fallback return empty dict if all models fail
    return {"tags": [], "edges": []}


def tag_flashcards_with_concepts(db: Session, user_id: int, lesson_id: int):
    # 1. Get all tags associated with this lesson
    stmt_tags = select(ConceptTag).join(LessonTag).where(LessonTag.lesson_id == lesson_id)
    tags = db.scalars(stmt_tags).all()
    if not tags:
        return

    # 2. Get all flashcards for this lesson
    stmt_cards = select(Flashcard).where(Flashcard.document_id == lesson_id)
    cards = db.scalars(stmt_cards).all()
    if not cards:
        return

    # Delete existing tag links for these cards
    card_ids = [c.id for c in cards]
    db.execute(delete(FlashcardTag).where(FlashcardTag.flashcard_id.in_(card_ids)))

    # Get set of already pending or existing tags in this session/db to avoid duplicates
    existing_links = set()
    for obj in db.new:
        if isinstance(obj, FlashcardTag):
            existing_links.add((obj.flashcard_id, obj.tag_id))

    for card in cards:
        matched_any = False
        card_content_lower = f"{card.front_text} {card.back_text}".lower()
        added_tag_ids = set()
        for tag in tags:
            if tag.id in added_tag_ids:
                continue
            tag_name_lower = tag.name.lower()
            # Use word-boundary match to prevent false positives
            # e.g., tag "AI" should NOT match "training", "explain"
            pattern = re.compile(rf'\b{re.escape(tag_name_lower)}\b')
            if pattern.search(card_content_lower):
                if (card.id, tag.id) not in existing_links:
                    db.add(FlashcardTag(flashcard_id=card.id, tag_id=tag.id))
                    existing_links.add((card.id, tag.id))
                added_tag_ids.add(tag.id)
                matched_any = True
        
        # If no tag matches, fall back to linking the card to the primary tag only
        # (avoids polluting unrelated concepts' weakness scores)
        if not matched_any and tags:
            first_tag = tags[0]
            if first_tag.id not in added_tag_ids:
                if (card.id, first_tag.id) not in existing_links:
                    db.add(FlashcardTag(flashcard_id=card.id, tag_id=first_tag.id))
                    existing_links.add((card.id, first_tag.id))


def save_concepts_and_edges(db: Session, user_id: int, lesson_id: int, data: dict):
    tags_list = data.get("tags", [])
    edges_list = data.get("edges", [])

    # 1. Save tags
    tag_name_to_model = {}
    for tag_name in tags_list:
        tag_name_clean = tag_name.strip()
        if not tag_name_clean:
            continue
        
        # Check if tag already exists for this user
        stmt = select(ConceptTag).where(
            and_(
                ConceptTag.user_id == user_id,
                ConceptTag.name == tag_name_clean
            )
        )
        tag = db.scalar(stmt)
        if not tag:
            tag = ConceptTag(user_id=user_id, name=tag_name_clean)
            db.add(tag)
            db.flush()  # populate tag.id
        
        tag_name_to_model[tag_name_clean.lower()] = tag

        # Associate tag with lesson (if not already linked)
        stmt_link = select(LessonTag).where(
            and_(
                LessonTag.lesson_id == lesson_id,
                LessonTag.tag_id == tag.id
            )
        )
        link = db.scalar(stmt_link)
        if not link:
            db.add(LessonTag(lesson_id=lesson_id, tag_id=tag.id))

    # 2. Save edges
    added_edges = set()
    for edge in edges_list:
        source_name = edge.get("source", "").strip()
        target_name = edge.get("target", "").strip()
        weight = max(0.1, min(1.0, float(edge.get("weight", 1.0))))
        rel_type = edge.get("relationship_type", "related_to").strip()

        source_tag = tag_name_to_model.get(source_name.lower())
        target_tag = tag_name_to_model.get(target_name.lower())

        if source_tag and target_tag and source_tag.id != target_tag.id:
            edge_key = (source_tag.id, target_tag.id)
            if edge_key in added_edges:
                continue
            # Check if edge already exists for this user
            stmt_edge = select(ConceptEdge).where(
                and_(
                    ConceptEdge.user_id == user_id,
                    ConceptEdge.source_tag_id == source_tag.id,
                    ConceptEdge.target_tag_id == target_tag.id
                )
            )
            existing_edge = db.scalar(stmt_edge)
            if not existing_edge:
                new_edge = ConceptEdge(
                    user_id=user_id,
                    source_tag_id=source_tag.id,
                    target_tag_id=target_tag.id,
                    weight=weight,
                    relationship_type=rel_type
                )
                db.add(new_edge)
                added_edges.add(edge_key)

    # 3. Create baseline ConceptWeakness records with default 0.5 score
    for tag in tag_name_to_model.values():
        stmt_weakness = select(ConceptWeakness).where(
            and_(
                ConceptWeakness.user_id == user_id,
                ConceptWeakness.tag_id == tag.id
            )
        )
        weakness = db.scalar(stmt_weakness)
        if not weakness:
            db.add(ConceptWeakness(
                user_id=user_id,
                tag_id=tag.id,
                weakness_score=0.5,
                card_count=0
            ))

    db.flush()

    # 4. Tag existing flashcards if there are any
    tag_flashcards_with_concepts(db=db, user_id=user_id, lesson_id=lesson_id)


def extract_and_save_concepts_for_lesson(db: Session, lesson: Lesson):
    try:
        text_source = lesson.content_markdown or lesson.source_content or ""
        if not text_source.strip():
            logger.warning("Lesson %s has empty content for keyword extraction", lesson.id)
            return

        logger.info("Extracting concepts for lesson_id=%s, title=%s", lesson.id, lesson.title)
        data = extract_concepts_from_text(lesson_title=lesson.title, text=text_source)
        if data and data.get("tags"):
            save_concepts_and_edges(db=db, user_id=lesson.user_id, lesson_id=lesson.id, data=data)
            db.commit()
            logger.info("Successfully extracted and saved concepts for lesson_id=%s", lesson.id)
        else:
            logger.warning("No concepts extracted for lesson_id=%s", lesson.id)
    except Exception as e:
        db.rollback()
        logger.error("Failed to extract and save concepts for lesson %s: %s", lesson.id, str(e), exc_info=True)
