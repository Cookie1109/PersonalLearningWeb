from __future__ import annotations

from datetime import datetime
import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


QUIZ_OPTION_PREFIX_PATTERN = re.compile(r"^[A-D][\.:\)]\s*", re.IGNORECASE)
QUIZ_INLINE_FENCE_PATTERN = re.compile(r"```([a-zA-Z0-9_+-]*)[ \t]+([\s\S]*?)```")


def _normalize_quiz_question_markdown(raw_text: str) -> str:
    text = str(raw_text)

    def _replace_inline_fence(match: re.Match[str]) -> str:
        language = (match.group(1) or "").strip()
        code_body = (match.group(2) or "").strip()
        opening_fence = f"```{language}".rstrip()
        return f"{opening_fence}\n{code_body}\n```"

    normalized = QUIZ_INLINE_FENCE_PATTERN.sub(_replace_inline_fence, text)
    normalized = re.sub(r":\s*```", ":\n```", normalized)
    return normalized.strip()


class ErrorResponseDTO(BaseModel):
    status: int
    message: str
    detail: dict[str, str] = Field(default_factory=dict)


class LoginRequestDTO(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=8, max_length=255)
    device_id: str | None = Field(default=None, min_length=8, max_length=128)


class UserProfileDTO(BaseModel):
    user_id: int
    email: str
    display_name: str
    level: int
    total_exp: int
    current_streak: int = 0
    total_study_days: int = 0


class ActivityDayDTO(BaseModel):
    date: str
    count: int = Field(default=0, ge=0)


class LoginResponseDTO(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserProfileDTO


class RefreshTokenRequestDTO(BaseModel):
    refresh_token: str | None = Field(default=None, min_length=16, max_length=4096)
    device_id: str | None = Field(default=None, min_length=8, max_length=128)


class RefreshTokenResponseDTO(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class LogoutRequestDTO(BaseModel):
    revoke_all_devices: bool = False


class RegisterRequestDTO(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=8, max_length=255)
    display_name: str | None = Field(default=None, min_length=2, max_length=120)


class GenericStatusDTO(BaseModel):
    status: str
    message: str


class DocumentCreateRequestDTO(BaseModel):
    title: str = Field(..., min_length=3, max_length=255)
    source_content: str = Field(..., min_length=30, max_length=120000)


class DocumentCreateResponseDTO(BaseModel):
    document_id: int
    title: str
    message: str


class DocumentSummaryDTO(BaseModel):
    id: int
    title: str
    is_completed: bool
    quiz_passed: bool = False
    flashcard_completed: bool = False
    created_at: datetime


class DocumentChatHistoryItemDTO(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=8000)


class DocumentChatRequestDTO(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    history: list[DocumentChatHistoryItemDTO] = Field(default_factory=list)


class DocumentChatResponseDTO(BaseModel):
    reply: str


class ParserExtractUrlRequestDTO(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)


class ParserExtractResponseDTO(BaseModel):
    extracted_text: str
    source_type: Literal["url", "pdf", "docx", "image"]
    extracted_title: str | None = None
    mime_type: str | None = None


class LessonCompleteResponseDTO(BaseModel):
    lesson_id: int
    exp_gained: int = Field(..., ge=0)
    streak_bonus_exp: int = Field(default=0, ge=0)
    total_exp: int = Field(..., ge=0)
    level: int = Field(..., ge=1)
    current_streak: int = Field(..., ge=0)
    already_completed: bool
    message: str


class FlashcardCompleteResponseDTO(BaseModel):
    lesson_id: int
    flashcard_completed: bool
    already_completed: bool
    message: str


class LessonDTO(BaseModel):
    id: str
    title: str
    duration: str
    completed: bool = False
    type: Literal["theory", "practice", "project"] = "theory"
    description: str
    youtube_video_id: str | None = None


class WeekModuleDTO(BaseModel):
    id: str
    week_number: int = Field(..., ge=1)
    title: str
    description: str
    lessons: list[LessonDTO]
    completed: bool = False
    expanded: bool = False


class RoadmapGenerateRequestDTO(BaseModel):
    goal: str = Field(..., min_length=3, max_length=500)


class RoadmapGenerateResponseDTO(BaseModel):
    weeks: list[WeekModuleDTO]


class RoadmapLessonItemDTO(BaseModel):
    id: int
    title: str
    is_completed: bool
    quiz_passed: bool = False
    flashcard_completed: bool = False


class RoadmapWeekItemDTO(BaseModel):
    week_number: int = Field(..., ge=1)
    title: str
    lessons: list[RoadmapLessonItemDTO] = Field(default_factory=list)


class RoadmapItemDTO(BaseModel):
    roadmap_id: int
    goal: str
    title: str
    weeks: list[RoadmapWeekItemDTO] = Field(default_factory=list)


class RoadmapMeResponseDTO(BaseModel):
    roadmaps: list[RoadmapItemDTO] = Field(default_factory=list)


class LessonExampleDTO(BaseModel):
    title: str
    description: str
    code: str | None = None


class LessonContentDTO(BaseModel):
    title: str
    theory: str
    examples: list[LessonExampleDTO]
    key_points: list[str]


class LessonDetailDTO(BaseModel):
    id: int
    title: str
    week_number: int = 1
    position: int = 1
    roadmap_id: int | None = None
    roadmap_title: str | None = None
    is_completed: bool
    quiz_passed: bool = False
    flashcard_completed: bool = False
    source_content: str | None = None
    content_markdown: str | None = None
    youtube_video_id: str | None = None
    is_draft: bool = True


class LessonGenerateResponseDTO(BaseModel):
    lesson: LessonDetailDTO


class QuizOptionDTO(BaseModel):
    option_key: str = Field(..., min_length=1, max_length=2)
    text: str


class QuizPublicQuestionDTO(BaseModel):
    question_id: str
    text: str
    options: list[QuizOptionDTO]
    type: Literal["theory", "fill_code", "find_bug"] | None = None
    difficulty: Literal["Easy", "Medium", "Hard"] | None = None


class QuizQuestionDTO(BaseModel):
    id: int
    type: Literal["theory", "fill_code", "find_bug"]
    difficulty: Literal["Easy", "Medium", "Hard"]
    question: str
    options: list[str] = Field(..., min_length=4, max_length=4)
    correct_answer: str
    explanation: str

    @field_validator("question", mode="before")
    @classmethod
    def normalize_question_markdown_code_block(cls, value: object) -> object:
        if isinstance(value, str):
            return _normalize_quiz_question_markdown(value)
        return value

    @field_validator("type", mode="before")
    @classmethod
    def normalize_type_to_lowercase(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value

    @field_validator("options", mode="before")
    @classmethod
    def normalize_options_whitespace(cls, value: object) -> object:
        if isinstance(value, list):
            return [QUIZ_OPTION_PREFIX_PATTERN.sub("", str(option)).strip() for option in value]
        return value

    @field_validator("correct_answer", mode="before")
    @classmethod
    def normalize_correct_answer_whitespace(cls, value: object) -> object:
        if isinstance(value, str):
            return QUIZ_OPTION_PREFIX_PATTERN.sub("", value).strip()
        return value

    @model_validator(mode="after")
    def validate_correct_answer_in_options(self) -> "QuizQuestionDTO":
        normalized_options = [QUIZ_OPTION_PREFIX_PATTERN.sub("", option).strip() for option in self.options]
        if any(not option for option in normalized_options):
            raise ValueError("Each option must be non-empty")

        normalized_correct_answer = QUIZ_OPTION_PREFIX_PATTERN.sub("", self.correct_answer).strip()
        if normalized_correct_answer not in normalized_options:
            raise ValueError("correct_answer must match one of the options")

        self.options = normalized_options
        self.correct_answer = normalized_correct_answer
        return self


class QuizResponseDTO(BaseModel):
    questions: list[QuizQuestionDTO] = Field(..., min_length=10, max_length=10)


class QuizPublicResponseDTO(BaseModel):
    quiz_id: str
    lesson_id: str
    questions: list[QuizPublicQuestionDTO]
    attempt: QuizAttemptSnapshotDTO | None = None


class QuizSubmitAnswerDTO(BaseModel):
    question_id: str
    selected_option: str = Field(..., min_length=1, max_length=10)


class QuizSubmitRequestDTO(BaseModel):
    answers: list[QuizSubmitAnswerDTO] = Field(default_factory=list)


class DocumentQuizSubmitRequestDTO(BaseModel):
    selected_answers: dict[str, str] = Field(default_factory=dict)


class QuizSubmitResultDTO(BaseModel):
    question_id: str
    is_correct: bool
    selected_option: str | None = None
    correct_answer: str | None = None
    explanation: str | None = None


class QuizSubmitResponseDTO(BaseModel):
    score: int = Field(..., ge=0, le=100)
    is_passed: bool
    exp_gained: int = Field(default=0, ge=0)
    streak_bonus_exp: int = Field(default=0, ge=0)
    total_exp: int = Field(..., ge=0)
    level: int = Field(..., ge=1)
    current_streak: int = Field(..., ge=0)
    reward_granted: bool = False
    message: str
    results: list[QuizSubmitResultDTO] = Field(default_factory=list)
    selected_answers: dict[str, str] = Field(default_factory=dict)


class QuizAttemptSnapshotDTO(QuizSubmitResponseDTO):
    submitted_at: datetime


class ChatMessageDTO(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=8000)


class ChatRequestDTO(BaseModel):
    messages: list[ChatMessageDTO] = Field(default_factory=list)


class ChatResponseDTO(BaseModel):
    reply: str


class ChatHistoryMessageDTO(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
