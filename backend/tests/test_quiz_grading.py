from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import ExpLedger, User


def test_server_grades_from_db_and_awards_first_pass_exp_once(client, db_session: Session, seed_quiz, auth_headers) -> None:
    user, quiz_id = seed_quiz
    _, headers = auth_headers

    # First submit is intentionally wrong to prove grading is server-side.
    wrong_submit = client.post(
        f"/api/quizzes/{quiz_id}/submit",
        json={
            "answers": [
                {"question_id": "q1", "selected_option": "A"},
                {"question_id": "q2", "selected_option": "A"},
            ]
        },
        headers=headers,
    )
    assert wrong_submit.status_code == 200
    wrong_payload = wrong_submit.json()
    assert wrong_payload["score"] == 0
    assert wrong_payload["is_passed"] is False
    assert wrong_payload["exp_earned"] == 0
    assert wrong_payload["first_pass_awarded"] is False
    assert any(item["question_id"] == "q1" and item["is_correct"] is False for item in wrong_payload["results"])

    # Correct submit should award exp only for the first pass.
    correct_submit = client.post(
        f"/api/quizzes/{quiz_id}/submit",
        json={
            "answers": [
                {"question_id": "q1", "selected_option": "B"},
                {"question_id": "q2", "selected_option": "C"},
            ]
        },
        headers=headers,
    )
    assert correct_submit.status_code == 200
    correct_payload = correct_submit.json()
    assert correct_payload["score"] == 100
    assert correct_payload["is_passed"] is True
    assert correct_payload["exp_earned"] == 100
    assert correct_payload["first_pass_awarded"] is True

    user_after_first_pass = db_session.scalar(select(User).where(User.id == user.id))
    assert user_after_first_pass is not None
    assert user_after_first_pass.total_exp == 100

    second_pass = client.post(
        f"/api/quizzes/{quiz_id}/submit",
        json={
            "answers": [
                {"question_id": "q1", "selected_option": "B"},
                {"question_id": "q2", "selected_option": "C"},
            ]
        },
        headers=headers,
    )
    assert second_pass.status_code == 200
    second_payload = second_pass.json()
    assert second_payload["is_passed"] is True
    assert second_payload["exp_earned"] == 0
    assert second_payload["first_pass_awarded"] is False

    settings = get_settings()
    reward_entries = list(
        db_session.scalars(
            select(ExpLedger).where(
                ExpLedger.user_id == user.id,
                ExpLedger.quiz_id == quiz_id,
                ExpLedger.reward_type == settings.quiz_first_pass_reward_type,
            )
        )
    )
    assert len(reward_entries) == 1
