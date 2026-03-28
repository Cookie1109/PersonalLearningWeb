from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


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


class QuizSubmitRequestDTO(BaseModel):
    quiz_id: str
    lesson_id: str
    user_answers: dict[str, str]


class QuizSubmitResultDTO(BaseModel):
    question_id: str
    is_correct: bool
    selected_option: str
    correct_answer: str | None = None
    explanation: str | None = None


class QuizSubmitResponseDTO(BaseModel):
    score: int = Field(..., ge=0, le=100)
    is_passed: bool
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
