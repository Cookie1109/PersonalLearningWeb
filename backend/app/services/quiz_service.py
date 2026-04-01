from __future__ import annotations

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.exceptions import AppException
from app.models import ExpLedger, Lesson, Question, Quiz, QuizAttempt, Roadmap, User
from app.schemas import QuizOptionDTO, QuizPublicQuestionDTO, QuizResponseDTO, QuizSubmitAnswerDTO, QuizSubmitResponseDTO, QuizSubmitResultDTO
from app.services.gamification_service import add_exp_and_check_level, get_current_streak, get_total_exp
from app.services.quiz_generation_service import generate_quiz_questions

OPTION_KEYS = ("A", "B", "C", "D")


def _get_lesson_for_user(*, db: Session, user_id: int, lesson_id: int, lock: bool = False) -> Lesson:
    stmt = (
        select(Lesson)
        .join(Roadmap, Lesson.roadmap_id == Roadmap.id)
        .where(and_(Lesson.id == lesson_id, Roadmap.user_id == user_id))
    )
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


def _to_quiz_response(quiz: Quiz) -> QuizResponseDTO:
    ordered_questions = sorted(quiz.questions, key=lambda item: (item.position, item.id))
    return QuizResponseDTO(
        quiz_id=str(quiz.id),
        lesson_id=str(quiz.lesson_id),
        questions=[_to_public_question(question) for question in ordered_questions],
    )


def get_quiz_for_lesson_user(*, db: Session, user_id: int, lesson_id: int) -> QuizResponseDTO:
    _get_lesson_for_user(db=db, user_id=user_id, lesson_id=lesson_id)

    quiz = db.scalar(
        select(Quiz)
        .where(Quiz.lesson_id == lesson_id)
        .options(selectinload(Quiz.questions))
    )

    if quiz is None or not quiz.questions:
        raise AppException(status_code=404, message="Quiz not found", detail={"code": "QUIZ_NOT_FOUND"})

    return _to_quiz_response(quiz)


def generate_quiz_for_lesson_user(*, db: Session, user_id: int, lesson_id: int) -> QuizResponseDTO:
    lesson = _get_lesson_for_user(db=db, user_id=user_id, lesson_id=lesson_id, lock=True)
    quiz = db.scalar(
        select(Quiz)
        .where(Quiz.lesson_id == lesson.id)
        .options(selectinload(Quiz.questions))
    )

    if quiz is not None and quiz.questions:
        return _to_quiz_response(quiz)

    markdown = (lesson.content_markdown or "").strip()
    if not markdown:
        raise AppException(
            status_code=409,
            message="Lesson content is empty",
            detail={"code": "LESSON_CONTENT_EMPTY"},
        )

    model_name, generated_questions = generate_quiz_questions(
        lesson_title=lesson.title,
        lesson_markdown=markdown,
    )

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
            joinedload(Quiz.lesson).joinedload(Lesson.roadmap),
        )
    )
    if quiz is None or quiz.lesson is None or quiz.lesson.roadmap is None or quiz.lesson.roadmap.user_id != user_id:
        raise AppException(status_code=404, message="Quiz not found", detail={"code": "QUIZ_NOT_FOUND"})
    if not quiz.questions:
        raise AppException(status_code=404, message="Quiz not found", detail={"code": "QUIZ_NOT_FOUND"})

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
        selected_option = _normalize_option_key(answer.selected_option)
        if selected_option is None:
            raise AppException(
                status_code=409,
                message="Selected option is invalid",
                detail={"code": "QUIZ_OPTION_INVALID", "question_id": str(question_id)},
            )

        answer_map[question_id] = selected_option

    ordered_questions = sorted(quiz.questions, key=lambda item: (item.position, item.id))
    valid_question_ids = {item.id for item in ordered_questions}

    results: list[QuizSubmitResultDTO] = []
    correct_count = 0

    for question_id in answer_map:
        if question_id not in valid_question_ids:
            raise AppException(
                status_code=409,
                message="Answer contains unknown question",
                detail={"code": "QUIZ_QUESTION_NOT_FOUND", "question_id": str(question_id)},
            )

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
                reward_type=reward_type,
                exp_amount=exp_gained,
                metadata_json={"source": reward_type, "score": score},
            )
            db.add(reward_entry)

        db.add(
            QuizAttempt(
                user_id=user_id,
                quiz_id=quiz.id,
                score=score,
                passed=is_passed,
                reward_granted=reward_granted,
                answers_json={str(question_id): selected for question_id, selected in answer_map.items()},
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
