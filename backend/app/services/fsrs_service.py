import logging
from datetime import datetime, timezone
import fsrs
from sqlalchemy.orm import Session
from sqlalchemy import select, and_

from app.core.exceptions import AppException
from app.models.fsrs_graph_models import FSRSCard, FSRSReview, FlashcardTag
from app.models.flashcard import Flashcard
from app.services.concept_aggregation import recalculate_concept_weakness

logger = logging.getLogger("app.fsrs_service")


def get_fsrs_card_or_init(db: Session, card_id: int) -> FSRSCard:
    """
    Get the FSRSCard from database. If it does not exist, initialize a new FSRS card
    and save it to database.
    """
    # Verify flashcard exists
    flashcard = db.get(Flashcard, card_id)
    if not flashcard:
        raise AppException(
            status_code=404,
            message="Flashcard not found",
            detail={"code": "FLASHCARD_NOT_FOUND"}
        )

    stmt = select(FSRSCard).where(FSRSCard.card_id == card_id)
    fsrs_card = db.scalar(stmt)
    if not fsrs_card:
        # Initialize default FSRS card parameters
        fsrs_card = FSRSCard(
            card_id=card_id,
            state=fsrs.State.Learning.value,
            step=0,
            stability=None,
            difficulty=None,
            due=datetime.now(timezone.utc),
            last_review=None
        )
        db.add(fsrs_card)
        db.flush()
    return fsrs_card


def review_card(
    db: Session,
    user_id: int,
    card_id: int,
    rating_val: int,
    review_duration: int = None
) -> FSRSCard:
    """
    Processes a card review rating:
    1. Runs py-fsrs scheduler.
    2. Updates FSRSCard properties.
    3. Logs review history.
    4. Recalculates weakness scores for all concepts associated with the card.
    """
    if rating_val not in (1, 2, 3, 4):
        raise AppException(
            status_code=400,
            message="Rating must be between 1 (Again) and 4 (Easy)",
            detail={"code": "FSRS_INVALID_RATING"}
        )

    # 1. Fetch FSRSCard (init if not present)
    fsrs_card = get_fsrs_card_or_init(db, card_id)

    # 2. Make sure user owns the card
    flashcard = db.get(Flashcard, card_id)
    if flashcard.lesson.user_id != user_id:
        raise AppException(
            status_code=403,
            message="Access denied: You do not own this card",
            detail={"code": "FSRS_ACCESS_DENIED"}
        )

    # 3. Instantiate py-fsrs Scheduler and py-fsrs Card
    scheduler = fsrs.Scheduler()
    
    # Ensure times are tz-aware UTC
    due_tz = fsrs_card.due
    if due_tz.tzinfo is None:
        due_tz = due_tz.replace(tzinfo=timezone.utc)
        
    last_review_tz = fsrs_card.last_review
    if last_review_tz is not None and last_review_tz.tzinfo is None:
        last_review_tz = last_review_tz.replace(tzinfo=timezone.utc)

    # Map current DB state to fsrs.State
    try:
        py_state = fsrs.State(fsrs_card.state)
    except ValueError:
        py_state = fsrs.State.Learning

    py_card = fsrs.Card(
        card_id=fsrs_card.card_id,
        state=py_state,
        step=fsrs_card.step,
        stability=fsrs_card.stability,
        difficulty=fsrs_card.difficulty,
        due=due_tz,
        last_review=last_review_tz
    )

    # 4. Review card with py-fsrs
    now_utc = datetime.now(timezone.utc)
    py_rating = fsrs.Rating(rating_val)
    updated_py_card, review_log = scheduler.review_card(py_card, py_rating, now_utc)

    # 5. Save updated card attributes back to DB model
    fsrs_card.state = updated_py_card.state.value
    fsrs_card.step = updated_py_card.step
    fsrs_card.stability = updated_py_card.stability
    fsrs_card.difficulty = updated_py_card.difficulty
    fsrs_card.due = updated_py_card.due
    fsrs_card.last_review = updated_py_card.last_review

    # 6. Log the review event
    review_history = FSRSReview(
        card_id=card_id,
        rating=rating_val,
        review_datetime=now_utc,
        review_duration=review_duration
    )
    db.add(review_history)
    db.flush()

    # 7. Recalculate concept weaknesses
    # Find all tags associated with this card
    stmt_tags = select(FlashcardTag.tag_id).where(FlashcardTag.flashcard_id == card_id)
    tag_ids = db.scalars(stmt_tags).all()
    for tag_id in tag_ids:
        recalculate_concept_weakness(db, user_id, tag_id)

    db.flush()
    db.refresh(fsrs_card)
    return fsrs_card
