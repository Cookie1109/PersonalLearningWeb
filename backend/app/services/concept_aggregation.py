from sqlalchemy.orm import Session
from sqlalchemy import select, and_

from app.models.fsrs_graph_models import FSRSCard, ConceptWeakness, FlashcardTag
from app.models.flashcard import Flashcard
from app.models.lesson import Lesson


def compute_weakness_score(cards: list[FSRSCard]) -> float:
    """
    weakness_score ∈ [0.0, 1.0]  —  càng cao = khái niệm càng yếu
    Trả về 0.5 nếu chưa có card (unknown concept).

    Cards chưa được review lần nào (stability=None) đóng góp neutral score (0.5),
    vì chưa học ≠ học yếu. Chỉ cards đã review mới ảnh hưởng tới weakness score thực.
    """
    if not cards:
        return 0.5

    MAX_STABLE = 21.0
    # Neutral stability = trung điểm của thang [0, MAX_STABLE]
    NEUTRAL_STABILITY = MAX_STABLE / 2.0  # 10.5 ngày → score = 0.5

    total_weight, weighted_stability = 0.0, 0.0
    for card in cards:
        # difficulty ∈ [1,10] trong py-fsrs — card khó được ưu tiên hơn
        difficulty = card.difficulty if card.difficulty is not None else 5.0

        if card.stability is None:
            # Card chưa được review → đóng góp neutral (không kéo score lên cao)
            effective_stability = NEUTRAL_STABILITY
        else:
            effective_stability = card.stability

        weighted_stability += effective_stability * difficulty
        total_weight += difficulty

    if total_weight <= 0.0:
        return 0.5

    avg_stability = weighted_stability / total_weight

    # Ngưỡng: stability ≥ 21 ngày → nhớ vững (score → 0)
    #          stability ≤ 0 ngày  → rất yếu  (score → 1)
    score = max(0.0, min(1.0, 1.0 - (avg_stability / MAX_STABLE)))
    return round(score, 4)


def recalculate_concept_weakness(db: Session, user_id: int, tag_id: int) -> ConceptWeakness:
    """
    Query all FSRSCards associated with tag_id for the user, calculate new weakness score,
    and update the concept_weakness table.
    """
    # Use explicit JOIN instead of correlated subquery (Flashcard.lesson.has())
    # for better performance on large datasets
    stmt = (
        select(FSRSCard)
        .join(Flashcard, FSRSCard.card_id == Flashcard.id)
        .join(Lesson, Flashcard.document_id == Lesson.id)
        .join(FlashcardTag, Flashcard.id == FlashcardTag.flashcard_id)
        .where(
            and_(
                Lesson.user_id == user_id,
                FlashcardTag.tag_id == tag_id
            )
        )
    )
    cards = list(db.scalars(stmt).all())
    
    score = compute_weakness_score(cards)
    
    stmt_weakness = select(ConceptWeakness).where(
        and_(
            ConceptWeakness.user_id == user_id,
            ConceptWeakness.tag_id == tag_id
        )
    )
    weakness = db.scalar(stmt_weakness)
    if not weakness:
        weakness = ConceptWeakness(
            user_id=user_id,
            tag_id=tag_id,
            weakness_score=score,
            card_count=len(cards)
        )
        db.add(weakness)
    else:
        weakness.weakness_score = score
        weakness.card_count = len(cards)
        
    db.flush()
    return weakness


def sync_concept_weakness_for_user(db: Session, user_id: int):
    """
    Scans all concept tags for the user and verifies that the weakness scores
    and card counts are in sync with the actual active FSRSCards.
    Updates or inserts records where needed.
    """
    from sqlalchemy import func
    from app.models.fsrs_graph_models import ConceptTag

    # 1. Fetch all tags for the user
    stmt_tags = select(ConceptTag).where(ConceptTag.user_id == user_id)
    tags = db.scalars(stmt_tags).all()
    if not tags:
        return

    # 2. Query actual card counts for all tags of this user
    stmt_counts = (
        select(FlashcardTag.tag_id, func.count(FSRSCard.card_id))
        .join(Flashcard, Flashcard.id == FlashcardTag.flashcard_id)
        .join(Lesson, Flashcard.document_id == Lesson.id)
        .join(FSRSCard, FSRSCard.card_id == Flashcard.id)
        .where(Lesson.user_id == user_id)
        .group_by(FlashcardTag.tag_id)
    )
    actual_counts = dict(db.execute(stmt_counts).all())

    # 3. Fetch all weakness records
    stmt_weakness = select(ConceptWeakness).where(ConceptWeakness.user_id == user_id)
    weaknesses = db.scalars(stmt_weakness).all()
    weakness_map = {w.tag_id: w for w in weaknesses}

    # 4. Check and sync
    updated = False
    for tag in tags:
        actual_cnt = actual_counts.get(tag.id, 0)
        weakness = weakness_map.get(tag.id)
        
        if not weakness or weakness.card_count != actual_cnt:
            recalculate_concept_weakness(db, user_id, tag.id)
            updated = True
            
    if updated:
        db.commit()

