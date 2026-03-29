from __future__ import annotations

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.models import ExpLedger, QuizAttempt, QuizItem, User
from app.schemas import QuizSubmitAnswerDTO, QuizSubmitResponseDTO, QuizSubmitResultDTO


def submit_quiz_for_user(
    *,
    db: Session,
    user_id: int,
    quiz_id: str,
    answers: list[QuizSubmitAnswerDTO],
    pass_score: int,
    reward_type: str,
) -> QuizSubmitResponseDTO:
    quiz_items = list(db.scalars(select(QuizItem).where(QuizItem.quiz_id == quiz_id)))
    if not quiz_items:
        raise AppException(status_code=404, message="Quiz not found", detail={"code": "QUIZ_NOT_FOUND"})

    answer_map: dict[str, str] = {}
    for answer in answers:
        if answer.question_id in answer_map:
            raise AppException(
                status_code=409,
                message="Duplicate answer for the same question",
                detail={"code": "QUIZ_DUPLICATE_ANSWER"},
            )
        answer_map[answer.question_id] = answer.selected_option

    lesson_id = quiz_items[0].lesson_id
    if any(item.lesson_id != lesson_id for item in quiz_items):
        raise AppException(
            status_code=409,
            message="Quiz answer key is inconsistent",
            detail={"code": "QUIZ_DATA_INCONSISTENT"},
        )

    results: list[QuizSubmitResultDTO] = []
    correct_count = 0
    valid_question_ids = {item.question_id for item in quiz_items}

    for question_id in answer_map:
        if question_id not in valid_question_ids:
            raise AppException(
                status_code=409,
                message="Answer contains unknown question",
                detail={"code": "QUIZ_QUESTION_NOT_FOUND", "question_id": question_id},
            )

    for item in quiz_items:
        selected_option = answer_map.get(item.question_id)
        is_correct = selected_option == item.correct_option
        if is_correct:
            correct_count += 1

        results.append(
            QuizSubmitResultDTO(
                question_id=item.question_id,
                is_correct=is_correct,
                selected_option=selected_option,
                correct_answer=item.correct_option,
                explanation=item.explanation,
            )
        )

    total_questions = len(quiz_items)
    score = int(round((correct_count / total_questions) * 100)) if total_questions > 0 else 0
    is_passed = score >= pass_score
    wrong_question_ids = [result.question_id for result in results if not result.is_correct]

    try:
        locked_user = db.scalar(select(User).where(User.id == user_id).with_for_update())
        if locked_user is None:
            raise AppException(status_code=401, message="User not found", detail={"code": "USER_NOT_FOUND"})

        passed_before = db.scalar(
            select(QuizAttempt.id)
            .where(
                and_(
                    QuizAttempt.user_id == user_id,
                    QuizAttempt.quiz_id == quiz_id,
                    QuizAttempt.is_passed.is_(True),
                )
            )
            .limit(1)
        )

        latest_attempt_no = db.scalar(
            select(func.max(QuizAttempt.attempt_no)).where(
                and_(
                    QuizAttempt.user_id == user_id,
                    QuizAttempt.quiz_id == quiz_id,
                )
            )
        )
        next_attempt_no = int(latest_attempt_no or 0) + 1

        quiz_attempt = QuizAttempt(
            user_id=user_id,
            lesson_id=lesson_id,
            quiz_id=quiz_id,
            score=score,
            is_passed=is_passed,
            attempt_no=next_attempt_no,
        )
        db.add(quiz_attempt)

        exp_earned = 0
        first_pass_awarded = False

        if is_passed and passed_before is None:
            existing_reward = db.scalar(
                select(ExpLedger).where(
                    and_(
                        ExpLedger.user_id == user_id,
                        ExpLedger.quiz_id == quiz_id,
                        ExpLedger.reward_type == reward_type,
                    )
                )
            )

            if existing_reward is None:
                exp_earned = score
                first_pass_awarded = True
                reward_entry = ExpLedger(
                    user_id=user_id,
                    lesson_id=lesson_id,
                    quiz_id=quiz_id,
                    reward_type=reward_type,
                    exp_amount=exp_earned,
                    metadata_json={"source": reward_type, "score": score},
                )
                db.add(reward_entry)
                locked_user.total_exp += exp_earned

        db.commit()

        return QuizSubmitResponseDTO(
            score=score,
            is_passed=is_passed,
            exp_earned=exp_earned,
            first_pass_awarded=first_pass_awarded,
            wrong_question_ids=wrong_question_ids,
            results=results,
        )
    except AppException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=409,
            message="Quiz submit failed",
            detail={"code": "QUIZ_SUBMIT_FAILED", "error": str(exc)},
        ) from exc
