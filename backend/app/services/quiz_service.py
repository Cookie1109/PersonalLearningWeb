from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.exceptions import AppException
from app.models import ExpLedger, Lesson, Question, Quiz, QuizAttempt, User
from app.schemas import (
    QuizAttemptSnapshotDTO,
    QuizOptionDTO,
    QuizPublicQuestionDTO,
    QuizPublicResponseDTO,
    QuizSubmitAnswerDTO,
    QuizSubmitResponseDTO,
    QuizSubmitResultDTO,
)
from app.services.gamification_service import add_exp_and_check_level, get_current_streak, get_total_exp
from app.services.quiz_generation_service import GeneratedQuizQuestion, generate_quiz_questions

OPTION_KEYS = ("A", "B", "C", "D")
QUIZ_TYPE_VALUES = {"theory", "fill_code", "find_bug", "general_choice", "fill_blank"}
QUIZ_DIFFICULTY_VALUES = {"Easy", "Medium", "Hard"}


def _build_quiz_content_payload(
    *,
    generated_questions: list[GeneratedQuizQuestion],
    generation_marker: str,
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for index, generated in enumerate(generated_questions, start=1):
        options = [str(option) for option in generated.options]
        resolved_correct_answer = (
            options[generated.correct_index]
            if 0 <= generated.correct_index < len(options)
            else ""
        )

        items.append(
            {
                "id": generated.question_id or index,
                "type": generated.question_type or "theory",
                "difficulty": generated.difficulty or "Medium",
                "question": generated.question,
                "options": options,
                "correct_answer": generated.correct_answer or resolved_correct_answer,
                "explanation": generated.explanation,
            }
        )

    return {
        "generation_marker": generation_marker,
        "questions": items,
    }


def _get_lesson_for_user(*, db: Session, user_id: int, lesson_id: int, lock: bool = False) -> Lesson:
    stmt = select(Lesson).where(and_(Lesson.id == lesson_id, Lesson.user_id == user_id))
    if lock:
        stmt = stmt.with_for_update()

    lesson = db.scalar(stmt)
    if lesson is None:
        raise AppException(status_code=404, message="Lesson not found", detail={"code": "LESSON_NOT_FOUND"})
    return lesson


def _normalize_option_key(value: str | None) -> str | None:
    if value is None:
        return None
    key = value.strip().upper()
    if key in OPTION_KEYS:
        return key
    return None


def _normalize_option_text(value: str | None) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def _resolve_option_key_for_question(*, question: Question, selected_value: str | None) -> str | None:
    normalized_key = _normalize_option_key(selected_value)
    if normalized_key is not None:
        return normalized_key

    normalized_selected_text = _normalize_option_text(selected_value)
    if not normalized_selected_text:
        return None

    options = question.options_json or []
    for index, option_text in enumerate(options):
        if _normalize_option_text(str(option_text)) == normalized_selected_text:
            return OPTION_KEYS[index]
    return None


def _extract_generation_marker(quiz: Quiz) -> str | None:
    if isinstance(quiz.quiz_content, dict):
        raw_marker = quiz.quiz_content.get("generation_marker")
        if isinstance(raw_marker, str) and raw_marker:
            return raw_marker
    return None


def _extract_selected_answers_from_attempt(attempt: QuizAttempt) -> dict[str, str]:
    selected_answers_payload = attempt.selected_answers
    if isinstance(selected_answers_payload, dict):
        return {
            str(question_id): str(selected_option)
            for question_id, selected_option in selected_answers_payload.items()
            if question_id is not None and selected_option is not None
        }

    # Backward compatibility for old rows that only used answers_json.
    answers_payload = attempt.answers_json
    if not isinstance(answers_payload, dict):
        return {}

    normalized: dict[str, str] = {}
    for question_id, selected_option in answers_payload.items():
        if question_id == "_generation_marker":
            continue
        if question_id is None or selected_option is None:
            continue
        normalized[str(question_id)] = str(selected_option)
    return normalized


def _attempt_matches_generation_marker(attempt: QuizAttempt, generation_marker: str | None) -> bool:
    if generation_marker is None:
        return True

    if isinstance(attempt.generation_marker, str) and attempt.generation_marker:
        return attempt.generation_marker == generation_marker

    answers_payload = attempt.answers_json
    if not isinstance(answers_payload, dict):
        return False
    return answers_payload.get("_generation_marker") == generation_marker


def _option_key_from_index(index: int) -> str:
    if index < 0 or index >= len(OPTION_KEYS):
        raise AppException(
            status_code=409,
            message="Quiz answer key is inconsistent",
            detail={"code": "QUIZ_DATA_INCONSISTENT"},
        )
    return OPTION_KEYS[index]


def _to_public_question(question: Question) -> QuizPublicQuestionDTO:
    options = question.options_json or []
    if len(options) != 4:
        raise AppException(
            status_code=409,
            message="Quiz answer key is inconsistent",
            detail={"code": "QUIZ_DATA_INCONSISTENT"},
        )

    return QuizPublicQuestionDTO(
        question_id=str(question.id),
        text=question.question_text,
        options=[
            QuizOptionDTO(option_key=OPTION_KEYS[index], text=str(option_text))
            for index, option_text in enumerate(options)
        ],
    )


def _extract_quiz_question_metadata(quiz: Quiz) -> list[dict[str, str]]:
    payload = quiz.quiz_content
    if not isinstance(payload, dict):
        return []

    questions_payload = payload.get("questions")
    if not isinstance(questions_payload, list):
        return []

    metadata_items: list[dict[str, str]] = []
    for item in questions_payload:
        if not isinstance(item, dict):
            metadata_items.append({})
            continue

        question_type = item.get("type")
        difficulty = item.get("difficulty")

        normalized: dict[str, str] = {}
        if isinstance(question_type, str) and question_type in QUIZ_TYPE_VALUES:
            normalized["type"] = question_type
        if isinstance(difficulty, str) and difficulty in QUIZ_DIFFICULTY_VALUES:
            normalized["difficulty"] = difficulty
        metadata_items.append(normalized)

    return metadata_items


def _to_public_question_with_metadata(question: Question, metadata: dict[str, str] | None) -> QuizPublicQuestionDTO:
    base = _to_public_question(question)
    if not metadata:
        return base

    return QuizPublicQuestionDTO(
        question_id=base.question_id,
        text=base.text,
        options=base.options,
        type=metadata.get("type"),
        difficulty=metadata.get("difficulty"),
    )


def _build_submit_results(
    *,
    ordered_questions: list[Question],
    answer_map: dict[int, str],
) -> tuple[list[QuizSubmitResultDTO], int]:
    results: list[QuizSubmitResultDTO] = []
    correct_count = 0

    for item in ordered_questions:
        selected_option = answer_map.get(item.id)
        selected_index = OPTION_KEYS.index(selected_option) if selected_option in OPTION_KEYS else None
        is_correct = selected_index == item.correct_index
        if is_correct:
            correct_count += 1

        results.append(
            QuizSubmitResultDTO(
                question_id=str(item.id),
                is_correct=is_correct,
                selected_option=selected_option,
                correct_answer=_option_key_from_index(item.correct_index),
                explanation=item.explanation,
            )
        )

    return results, correct_count


def _build_attempt_snapshot_for_current_generation(*, db: Session, user_id: int, quiz: Quiz) -> QuizAttemptSnapshotDTO | None:
    generation_marker = _extract_generation_marker(quiz)

    attempts = list(
        db.scalars(
            select(QuizAttempt)
            .where(
                and_(
                    QuizAttempt.user_id == user_id,
                    QuizAttempt.quiz_id == quiz.id,
                )
            )
            .order_by(QuizAttempt.id.desc())
        )
    )

    target_attempt: QuizAttempt | None = None
    for attempt in attempts:
        if _attempt_matches_generation_marker(attempt, generation_marker):
            target_attempt = attempt
            break

    if target_attempt is None:
        return None

    selected_answers = _extract_selected_answers_from_attempt(target_attempt)
    ordered_questions = sorted(quiz.questions, key=lambda item: (item.position, item.id))

    answer_map: dict[int, str] = {}
    question_by_id: dict[int, Question] = {item.id: item for item in ordered_questions}
    for question_id_raw, selected_value in selected_answers.items():
        try:
            question_id = int(question_id_raw)
        except (TypeError, ValueError):
            continue

        question = question_by_id.get(question_id)
        if question is None:
            continue

        selected_key = _resolve_option_key_for_question(question=question, selected_value=selected_value)
        if selected_key is None:
            continue
        answer_map[question_id] = selected_key

    results, _ = _build_submit_results(ordered_questions=ordered_questions, answer_map=answer_map)

    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise AppException(status_code=401, message="User not found", detail={"code": "USER_NOT_FOUND"})

    return QuizAttemptSnapshotDTO(
        score=target_attempt.score,
        is_passed=target_attempt.passed,
        exp_gained=0,
        streak_bonus_exp=0,
        total_exp=get_total_exp(user),
        level=user.level,
        current_streak=get_current_streak(user),
        reward_granted=target_attempt.reward_granted,
        message="Quiz attempt restored",
        results=results,
        selected_answers={str(question_id): selected_option for question_id, selected_option in answer_map.items()},
        submitted_at=target_attempt.submitted_at if isinstance(target_attempt.submitted_at, datetime) else datetime.utcnow(),
    )


def _to_quiz_response(quiz: Quiz, attempt: QuizAttemptSnapshotDTO | None = None) -> QuizPublicResponseDTO:
    ordered_questions = sorted(quiz.questions, key=lambda item: (item.position, item.id))
    metadata_items = _extract_quiz_question_metadata(quiz)
    return QuizPublicResponseDTO(
        quiz_id=str(quiz.id),
        lesson_id=str(quiz.lesson_id),
        questions=[
            _to_public_question_with_metadata(
                question,
                metadata_items[index] if index < len(metadata_items) else None,
            )
            for index, question in enumerate(ordered_questions)
        ],
        attempt=attempt,
    )


def get_quiz_for_lesson_user(*, db: Session, user_id: int, lesson_id: int) -> QuizPublicResponseDTO:
    _get_lesson_for_user(db=db, user_id=user_id, lesson_id=lesson_id)

    quiz = db.scalar(
        select(Quiz)
        .where(Quiz.lesson_id == lesson_id)
        .options(selectinload(Quiz.questions))
    )

    if quiz is None or not quiz.questions:
        raise AppException(status_code=404, message="Quiz not found", detail={"code": "QUIZ_NOT_FOUND"})

    attempt = _build_attempt_snapshot_for_current_generation(db=db, user_id=user_id, quiz=quiz)
    return _to_quiz_response(quiz, attempt)


def ensure_quiz_regeneration_allowed_for_lesson_user(*, db: Session, user_id: int, lesson_id: int) -> None:
    _get_lesson_for_user(db=db, user_id=user_id, lesson_id=lesson_id)

    quiz = db.scalar(
        select(Quiz)
        .where(Quiz.lesson_id == lesson_id)
        .options(selectinload(Quiz.questions))
    )

    if quiz is None or not quiz.questions:
        return

    generation_marker = _extract_generation_marker(quiz)

    attempts = list(
        db.scalars(
            select(QuizAttempt)
            .where(
                and_(
                    QuizAttempt.user_id == user_id,
                    QuizAttempt.quiz_id == quiz.id,
                )
            )
            .order_by(QuizAttempt.id.desc())
        )
    )

    has_submission_for_current_generation = False
    if generation_marker is not None:
        for attempt in attempts:
            if _attempt_matches_generation_marker(attempt, generation_marker):
                has_submission_for_current_generation = True
                break
    else:
        has_submission_for_current_generation = len(attempts) > 0

    if not has_submission_for_current_generation:
        raise AppException(
            status_code=403,
            message="Hoàn thành bài làm cũ trước khi tạo mới",
            detail={"code": "QUIZ_REGENERATION_REQUIRES_SUBMISSION"},
        )


def generate_quiz_for_lesson_user(*, db: Session, user_id: int, lesson_id: int) -> QuizPublicResponseDTO:
    lesson = _get_lesson_for_user(db=db, user_id=user_id, lesson_id=lesson_id, lock=True)
    quiz = db.scalar(
        select(Quiz)
        .where(Quiz.lesson_id == lesson.id)
        .options(selectinload(Quiz.questions))
    )

    source_content = (lesson.source_content or "").strip()
    if not source_content:
        raise AppException(
            status_code=409,
            message="Document source content is empty",
            detail={"code": "LESSON_SOURCE_EMPTY"},
        )

    model_name, generated_questions = generate_quiz_questions(
        lesson_title=lesson.title,
        source_content=source_content,
    )
    generation_marker = uuid4().hex

    try:
        if quiz is None:
            quiz = Quiz(lesson_id=lesson.id, model_name=model_name)
            db.add(quiz)
            db.flush()
        else:
            quiz.model_name = model_name
            for existing_question in list(quiz.questions):
                db.delete(existing_question)
            db.flush()

        quiz.quiz_content = _build_quiz_content_payload(
            generated_questions=generated_questions,
            generation_marker=generation_marker,
        )

        for index, generated in enumerate(generated_questions, start=1):
            db.add(
                Question(
                    quiz_id=quiz.id,
                    question_text=generated.question,
                    options_json=generated.options,
                    correct_index=generated.correct_index,
                    explanation=generated.explanation,
                    position=index,
                )
            )

        db.commit()
    except AppException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=409,
            message="Quiz generation failed",
            detail={"code": "QUIZ_GENERATION_FAILED", "error": str(exc)},
        ) from exc

    refreshed_quiz = db.scalar(
        select(Quiz)
        .where(Quiz.id == quiz.id)
        .options(selectinload(Quiz.questions))
    )
    if refreshed_quiz is None:
        raise AppException(status_code=404, message="Quiz not found", detail={"code": "QUIZ_NOT_FOUND"})
    return _to_quiz_response(refreshed_quiz)


def submit_quiz_for_user(
    *,
    db: Session,
    user_id: int,
    quiz_id: str,
    answers: list[QuizSubmitAnswerDTO],
    pass_score: int,
    reward_exp: int,
    reward_type: str,
) -> QuizSubmitResponseDTO:
    try:
        quiz_id_int = int(quiz_id)
    except (TypeError, ValueError) as exc:
        raise AppException(status_code=404, message="Quiz not found", detail={"code": "QUIZ_NOT_FOUND"}) from exc

    quiz = db.scalar(
        select(Quiz)
        .where(Quiz.id == quiz_id_int)
        .options(
            selectinload(Quiz.questions),
            joinedload(Quiz.lesson),
        )
    )
    if quiz is None or quiz.lesson is None or quiz.lesson.user_id != user_id:
        raise AppException(status_code=404, message="Quiz not found", detail={"code": "QUIZ_NOT_FOUND"})
    if not quiz.questions:
        raise AppException(status_code=404, message="Quiz not found", detail={"code": "QUIZ_NOT_FOUND"})

    ordered_questions = sorted(quiz.questions, key=lambda item: (item.position, item.id))
    valid_question_ids = {item.id for item in ordered_questions}
    question_by_id: dict[int, Question] = {item.id: item for item in ordered_questions}

    answer_map: dict[int, str] = {}
    for answer in answers:
        try:
            question_id = int(answer.question_id)
        except (TypeError, ValueError) as exc:
            raise AppException(
                status_code=409,
                message="Answer contains unknown question",
                detail={"code": "QUIZ_QUESTION_NOT_FOUND", "question_id": answer.question_id},
            ) from exc

        if question_id in answer_map:
            raise AppException(
                status_code=409,
                message="Duplicate answer for the same question",
                detail={"code": "QUIZ_DUPLICATE_ANSWER"},
            )

        if question_id not in valid_question_ids:
            raise AppException(
                status_code=409,
                message="Answer contains unknown question",
                detail={"code": "QUIZ_QUESTION_NOT_FOUND", "question_id": str(question_id)},
            )

        selected_option = _resolve_option_key_for_question(
            question=question_by_id[question_id],
            selected_value=answer.selected_option,
        )
        if selected_option is None:
            raise AppException(
                status_code=409,
                message="Selected option is invalid",
                detail={"code": "QUIZ_OPTION_INVALID", "question_id": str(question_id)},
            )

        answer_map[question_id] = selected_option

    results, correct_count = _build_submit_results(ordered_questions=ordered_questions, answer_map=answer_map)

    total_questions = len(ordered_questions)
    score = int(round((correct_count / total_questions) * 100)) if total_questions > 0 else 0
    is_passed = score >= pass_score

    try:
        locked_user = db.scalar(select(User).where(User.id == user_id).with_for_update())
        if locked_user is None:
            raise AppException(status_code=401, message="User not found", detail={"code": "USER_NOT_FOUND"})

        passed_and_rewarded_before = db.scalar(
            select(QuizAttempt.id)
            .where(
                and_(
                    QuizAttempt.user_id == user_id,
                    QuizAttempt.quiz_id == quiz.id,
                    QuizAttempt.passed.is_(True),
                    QuizAttempt.reward_granted.is_(True),
                )
            )
            .limit(1)
        )

        exp_reward_exists = db.scalar(
            select(ExpLedger.id).where(
                and_(
                    ExpLedger.user_id == user_id,
                    ExpLedger.quiz_id == str(quiz.id),
                    ExpLedger.reward_type == reward_type,
                )
            )
        )

        exp_gained = 0
        reward_granted = False

        if is_passed and passed_and_rewarded_before is None and exp_reward_exists is None:
            exp_gained = add_exp_and_check_level(locked_user, reward_exp)
            reward_granted = exp_gained > 0
            reward_entry = ExpLedger(
                user_id=user_id,
                lesson_id=quiz.lesson_id,
                quiz_id=str(quiz.id),
                action_type="PASS_QUIZ",
                target_id=str(quiz.id),
                reward_type=reward_type,
                exp_amount=exp_gained,
                metadata_json={"source": reward_type, "score": score},
            )
            db.add(reward_entry)

        selected_answers_payload = {str(question_id): selected for question_id, selected in answer_map.items()}
        generation_marker = _extract_generation_marker(quiz)

        db.add(
            QuizAttempt(
                user_id=user_id,
                quiz_id=quiz.id,
                score=score,
                passed=is_passed,
                reward_granted=reward_granted,
                generation_marker=generation_marker,
                selected_answers=selected_answers_payload,
                answers_json=selected_answers_payload,
            )
        )

        db.commit()
        db.refresh(locked_user)

        total_exp = get_total_exp(locked_user)
        current_streak = get_current_streak(locked_user)

        if is_passed and reward_granted:
            message = "Quiz passed and reward granted"
        elif is_passed:
            message = "Quiz passed but reward was already claimed"
        else:
            message = "Quiz not passed"

        return QuizSubmitResponseDTO(
            score=score,
            is_passed=is_passed,
            exp_gained=exp_gained,
            streak_bonus_exp=0,
            total_exp=total_exp,
            level=locked_user.level,
            current_streak=current_streak,
            reward_granted=reward_granted,
            message=message,
            results=results,
            selected_answers=selected_answers_payload,
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


def submit_quiz_for_lesson_user(
    *,
    db: Session,
    user_id: int,
    lesson_id: int,
    selected_answers: dict[str, str],
    pass_score: int,
    reward_exp: int,
    reward_type: str,
) -> QuizSubmitResponseDTO:
    _get_lesson_for_user(db=db, user_id=user_id, lesson_id=lesson_id)

    quiz = db.scalar(
        select(Quiz)
        .where(Quiz.lesson_id == lesson_id)
        .options(selectinload(Quiz.questions))
    )
    if quiz is None or not quiz.questions:
        raise AppException(status_code=404, message="Quiz not found", detail={"code": "QUIZ_NOT_FOUND"})

    answers = [
        QuizSubmitAnswerDTO(question_id=str(question_id), selected_option=str(selected_option))
        for question_id, selected_option in selected_answers.items()
    ]

    return submit_quiz_for_user(
        db=db,
        user_id=user_id,
        quiz_id=str(quiz.id),
        answers=answers,
        pass_score=pass_score,
        reward_exp=reward_exp,
        reward_type=reward_type,
    )
