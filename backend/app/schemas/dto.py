from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


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


class LessonCompleteResponseDTO(BaseModel):
    lesson_id: int
    exp_earned: int = Field(..., ge=0)
    total_exp: int = Field(..., ge=0)
    already_completed: bool
    message: str


class LessonDTO(BaseModel):
    id: str
    title: str
    duration: str
    completed: bool = False
    type: Literal["theory", "practice", "project"] = "theory"
    description: str


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


class LessonExampleDTO(BaseModel):
    title: str
    description: str
    code: str | None = None


class LessonContentDTO(BaseModel):
    title: str
    theory: str
    examples: list[LessonExampleDTO]
    key_points: list[str]
    youtube_query: str


class YouTubeVideoDTO(BaseModel):
    id: str
    title: str
    channel: str
    thumbnail: str
    duration: str
    views: str
    url: str


class QuizOptionDTO(BaseModel):
    option_key: str = Field(..., min_length=1, max_length=2)
    text: str


class QuizPublicQuestionDTO(BaseModel):
    question_id: str
    text: str
    options: list[QuizOptionDTO]


class QuizResponseDTO(BaseModel):
    quiz_id: str
    lesson_id: str
    questions: list[QuizPublicQuestionDTO]


class QuizSubmitAnswerDTO(BaseModel):
    question_id: str
    selected_option: str = Field(..., min_length=1, max_length=10)


class QuizSubmitRequestDTO(BaseModel):
    answers: list[QuizSubmitAnswerDTO] = Field(default_factory=list)


class QuizSubmitResultDTO(BaseModel):
    question_id: str
    is_correct: bool
    selected_option: str | None = None
    correct_answer: str | None = None
    explanation: str | None = None


class QuizSubmitResponseDTO(BaseModel):
    score: int = Field(..., ge=0, le=100)
    is_passed: bool
    exp_earned: int = Field(default=0, ge=0)
    first_pass_awarded: bool = False
    wrong_question_ids: list[str] = Field(default_factory=list)
    results: list[QuizSubmitResultDTO] | None = None


class ChatMessageDTO(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    timestamp: str


class ChatRequestDTO(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    history: list[ChatMessageDTO] = Field(default_factory=list)


class ChatResponseDTO(BaseModel):
    reply: str
