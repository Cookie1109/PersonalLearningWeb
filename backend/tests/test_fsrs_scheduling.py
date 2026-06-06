from datetime import datetime, timezone, timedelta
import pytest
from sqlalchemy.orm import Session
from sqlalchemy import select, and_
from fastapi.testclient import TestClient


from app.models import Lesson, Flashcard, User
from app.models.fsrs_graph_models import FSRSCard, FSRSReview, ConceptTag, ConceptEdge, ConceptWeakness, FlashcardTag, LessonTag
from app.services.fsrs_service import review_card, get_fsrs_card_or_init
from app.services.concept_aggregation import recalculate_concept_weakness, compute_weakness_score


@pytest.fixture
def seed_lesson_and_card(db_session: Session, create_user):
    user, _ = create_user(email="fsrstest@example.com")

    lesson = Lesson(
        user_id=user.id,
        title="FSRS Data Structures",
        source_content="Stack and Queue are basic linear data structures."
    )
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)

    card = Flashcard(
        document_id=lesson.id,
        front_text="What is a Stack?",
        back_text="LIFO data structure.",
        status="new"
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)

    tag = ConceptTag(user_id=user.id, name="Stack")
    db_session.add(tag)
    db_session.commit()
    db_session.refresh(tag)

    db_session.add(LessonTag(lesson_id=lesson.id, tag_id=tag.id))
    db_session.add(FlashcardTag(flashcard_id=card.id, tag_id=tag.id))
    db_session.commit()

    return user, lesson, card, tag


def test_fsrs_card_initialization(db_session: Session, seed_lesson_and_card):
    user, lesson, card, tag = seed_lesson_and_card

    # Initialize FSRS card
    fsrs_card = get_fsrs_card_or_init(db_session, card.id)
    assert fsrs_card is not None
    assert fsrs_card.card_id == card.id
    assert fsrs_card.state == 1 # Learning
    assert fsrs_card.stability is None
    assert fsrs_card.difficulty is None
    assert fsrs_card.step == 0


def test_fsrs_review_good_increases_stability(db_session: Session, seed_lesson_and_card):
    user, lesson, card, tag = seed_lesson_and_card

    # Good rating (3)
    updated_card = review_card(
        db=db_session,
        user_id=user.id,
        card_id=card.id,
        rating_val=3
    )

    assert updated_card.last_review is not None
    assert updated_card.stability is not None
    assert updated_card.difficulty is not None
    first_stability = updated_card.stability

    # Review again with Good (3) after simulated time passes
    # Update due and last review to simulate elapsed time
    updated_card.last_review = datetime.now(timezone.utc) - timedelta(days=2)
    db_session.commit()

    second_review_card = review_card(
        db=db_session,
        user_id=user.id,
        card_id=card.id,
        rating_val=3
    )
    assert second_review_card.stability > first_stability


def test_fsrs_review_again_decreases_stability(db_session: Session, seed_lesson_and_card):
    user, lesson, card, tag = seed_lesson_and_card

    # Good rating (3) first
    updated_card = review_card(
        db=db_session,
        user_id=user.id,
        card_id=card.id,
        rating_val=3
    )
    first_stability = updated_card.stability

    # Again rating (1)
    updated_card.last_review = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.commit()

    again_card = review_card(
        db=db_session,
        user_id=user.id,
        card_id=card.id,
        rating_val=1
    )
    assert again_card.stability < first_stability


def test_concept_weakness_calculation(db_session: Session, seed_lesson_and_card):
    user, lesson, card, tag = seed_lesson_and_card

    # Recalculate initially with default values
    fsrs_card = get_fsrs_card_or_init(db_session, card.id)
    weakness = recalculate_concept_weakness(db_session, user.id, tag.id)
    # Card is freshly initialized with stability=None → compute_weakness_score
    # uses NEUTRAL_STABILITY=10.5 → score = 1.0 - (10.5/21.0) = 0.5
    assert weakness.weakness_score == 0.5
    assert weakness.card_count == 1

    # After Good reviews stability increases. Set stability manually to simulate a strong concept
    fsrs_card.stability = 15.0
    fsrs_card.difficulty = 3.0
    db_session.commit()
    
    # Weakness score should go down (concept gets stronger)
    weakness_after = recalculate_concept_weakness(db_session, user.id, tag.id)
    assert weakness_after.weakness_score < 0.5


def test_review_schedule_endpoint(client: TestClient, db_session: Session, seed_lesson_and_card):
    user, lesson, card, tag = seed_lesson_and_card
    
    # Authenticate as user
    from conftest import build_test_auth_headers
    headers = build_test_auth_headers(firebase_uid=user.firebase_uid, email=user.email)

    # Initialize FSRS card so it's due now
    get_fsrs_card_or_init(db_session, card.id)
    db_session.commit()

    response = client.get("/api/flashcards/review-schedule", headers=headers)
    assert response.status_code == 200
    res_data = response.json()
    assert len(res_data) == 1
    assert res_data[0]["card_id"] == card.id
    assert res_data[0]["front_text"] == card.front_text


def test_submit_review_endpoint(client: TestClient, db_session: Session, seed_lesson_and_card):
    user, lesson, card, tag = seed_lesson_and_card
    
    from conftest import build_test_auth_headers
    headers = build_test_auth_headers(firebase_uid=user.firebase_uid, email=user.email)

    # Submit review
    response = client.post(
        f"/api/flashcards/{card.id}/review",
        json={"rating": 3, "review_duration": 1500},
        headers=headers
    )
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["card_id"] == card.id
    assert res_data["stability"] is not None


def test_knowledge_graph_endpoints(client: TestClient, db_session: Session, seed_lesson_and_card):
    user, lesson, card, tag = seed_lesson_and_card
    
    from conftest import build_test_auth_headers
    headers = build_test_auth_headers(firebase_uid=user.firebase_uid, email=user.email)

    # Initialize weakness and edge
    fsrs_card = get_fsrs_card_or_init(db_session, card.id)
    # Set stability to a low value manually so weakness_score > 0.60
    fsrs_card.stability = 1.0
    fsrs_card.difficulty = 8.0
    db_session.commit()
    recalculate_concept_weakness(db_session, user.id, tag.id)
    
    # Create a second tag so edge connects two distinct concepts (no self-loop)
    tag2 = ConceptTag(user_id=user.id, name="Queue")
    db_session.add(tag2)
    db_session.commit()
    db_session.refresh(tag2)

    edge = ConceptEdge(user_id=user.id, source_tag_id=tag.id, target_tag_id=tag2.id, weight=1.0)
    db_session.add(edge)
    db_session.commit()

    # Test GET /api/knowledge-graph
    response = client.get("/api/knowledge-graph", headers=headers)
    assert response.status_code == 200
    res_data = response.json()
    assert "nodes" in res_data
    assert "edges" in res_data
    assert len(res_data["nodes"]) == 2
    tag_names = {n["name"] for n in res_data["nodes"]}
    assert tag.name in tag_names

    # Test GET /api/knowledge-graph/weak-concepts
    response_weak = client.get("/api/knowledge-graph/weak-concepts", headers=headers)
    assert response_weak.status_code == 200
    res_weak = response_weak.json()
    assert len(res_weak) == 1
    assert res_weak[0]["name"] == tag.name


def test_self_healing_weakness_sync(db_session: Session, seed_lesson_and_card):
    user, lesson, card, tag = seed_lesson_and_card

    # Initialize FSRSCard and calculate weakness score
    fsrs_card = get_fsrs_card_or_init(db_session, card.id)
    # Set stability to a low value manually so weakness_score > 0.5
    fsrs_card.stability = 2.0
    fsrs_card.difficulty = 8.0
    db_session.commit()
    recalculate_concept_weakness(db_session, user.id, tag.id)
    db_session.commit()

    # Check weakness score and card_count are set initially
    w_initial = db_session.scalar(
        select(ConceptWeakness).where(
            and_(ConceptWeakness.user_id == user.id, ConceptWeakness.tag_id == tag.id)
        )
    )
    assert w_initial.card_count == 1
    assert w_initial.weakness_score > 0.5

    # Simulate deleting the card (cascade deletes FSRSCard & FlashcardTag)
    from sqlalchemy import delete
    db_session.execute(delete(FlashcardTag).where(FlashcardTag.flashcard_id == card.id))
    db_session.execute(delete(FSRSCard).where(FSRSCard.card_id == card.id))
    db_session.execute(delete(Flashcard).where(Flashcard.id == card.id))
    db_session.commit()

    # Call self-healing sync
    from app.services.concept_aggregation import sync_concept_weakness_for_user
    sync_concept_weakness_for_user(db_session, user.id)

    # Verify concept_weakness is healed to card_count = 0 and weakness_score = 0.5
    w_healed = db_session.scalar(
        select(ConceptWeakness).where(
            and_(ConceptWeakness.user_id == user.id, ConceptWeakness.tag_id == tag.id)
        )
    )
    assert w_healed.card_count == 0
    assert w_healed.weakness_score == 0.5
