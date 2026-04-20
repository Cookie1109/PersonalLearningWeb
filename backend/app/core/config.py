import json
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = Field(default="Personal Learning API", alias="APP_NAME")
    app_env: str = Field(default="dev", alias="APP_ENV")
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8001, alias="APP_PORT")
    api_prefix: str = Field(default="/api", alias="API_PREFIX")
    cors_allow_origins: list[str] = Field(
        default=["http://localhost:5173", "http://127.0.0.1:5173"],
        alias="CORS_ALLOW_ORIGINS",
    )
    cors_allow_origin_regex: str | None = Field(
        default=r"^https://.*\.vercel\.app$",
        alias="CORS_ALLOW_ORIGIN_REGEX",
    )
    cors_allow_credentials: bool = Field(default=True, alias="CORS_ALLOW_CREDENTIALS")

    database_url: str = Field(
        default="mysql+pymysql://root:root@localhost:3306/personal_learning",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")

    firebase_project_id: str | None = Field(default=None, alias="FIREBASE_PROJECT_ID")
    firebase_credentials_path: str | None = Field(default=None, alias="FIREBASE_CREDENTIALS_PATH")
    firebase_credentials_json: str | None = Field(default=None, alias="FIREBASE_CREDENTIALS_JSON")
    firebase_check_revoked: bool = Field(default=False, alias="FIREBASE_CHECK_REVOKED")
    idempotency_ttl_seconds: int = Field(default=86400, alias="IDEMPOTENCY_TTL_SECONDS")
    lesson_complete_reward_exp: int = Field(default=50, alias="LESSON_COMPLETE_REWARD_EXP")
    quiz_pass_score: int = Field(default=80, alias="QUIZ_PASS_SCORE")
    quiz_pass_reward_exp: int = Field(default=100, alias="QUIZ_PASS_REWARD_EXP")
    quiz_first_pass_reward_type: str = Field(default="quiz_first_pass", alias="QUIZ_FIRST_PASS_REWARD_TYPE")
    daily_quest_reset_timezone: str = Field(default="Asia/Ho_Chi_Minh", alias="DAILY_QUEST_RESET_TIMEZONE")
    daily_quest_all_clear_bonus_exp: int = Field(default=100, alias="DAILY_QUEST_ALL_CLEAR_BONUS_EXP")
    gamification_track_read_exp_per_unit: int = Field(default=2, alias="GAMIFICATION_TRACK_READ_EXP_PER_UNIT")
    gamification_track_flashcard_exp_per_unit: int = Field(default=4, alias="GAMIFICATION_TRACK_FLASHCARD_EXP_PER_UNIT")
    gamification_track_summary_exp_per_unit: int = Field(default=30, alias="GAMIFICATION_TRACK_SUMMARY_EXP_PER_UNIT")
    quiz_cooldown_fail_4_5_seconds: int = Field(default=30, alias="QUIZ_COOLDOWN_FAIL_4_5_SECONDS")
    quiz_cooldown_fail_6_plus_seconds: int = Field(default=60, alias="QUIZ_COOLDOWN_FAIL_6_PLUS_SECONDS")
    quiz_cooldown_state_ttl_seconds: int = Field(default=86400, alias="QUIZ_COOLDOWN_STATE_TTL_SECONDS")
    quiz_regeneration_limit_enabled: bool = Field(default=True, alias="QUIZ_REGENERATION_LIMIT_ENABLED")
    quiz_regeneration_limit_max_requests: int = Field(default=3, alias="QUIZ_REGENERATION_LIMIT_MAX_REQUESTS")
    quiz_regeneration_limit_window_seconds: int = Field(default=600, alias="QUIZ_REGENERATION_LIMIT_WINDOW_SECONDS")
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model: str = Field(
        default="gemini-2.5-flash",
        alias="GEMINI_MODEL",
        validation_alias=AliasChoices("GEMINI_MODEL", "GEMINI_FLASH_MODEL"),
    )
    gemini_quiz_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_QUIZ_MODEL")
    gemini_pro_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_PRO_MODEL")
    gemini_timeout_seconds: float = Field(default=120.0, alias="GEMINI_TIMEOUT_SECONDS")
    youtube_api_key: str | None = Field(default=None, alias="YOUTUBE_API_KEY")
    cloudinary_cloud_name: str | None = Field(default=None, alias="CLOUDINARY_CLOUD_NAME")
    cloudinary_api_key: str | None = Field(default=None, alias="CLOUDINARY_API_KEY")
    cloudinary_api_secret: str | None = Field(default=None, alias="CLOUDINARY_API_SECRET")
    cloudinary_upload_folder: str = Field(default="personal-learning/documents", alias="CLOUDINARY_UPLOAD_FOLDER")
    cloudinary_avatar_folder: str = Field(default="personal-learning/avatars", alias="CLOUDINARY_AVATAR_FOLDER")

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def parse_cors_allow_origins(cls, value: object) -> list[str]:
        if value is None:
            return []

        if isinstance(value, str):
            raw_value = value.strip()
            if not raw_value:
                return []

            if raw_value.startswith("["):
                try:
                    parsed = json.loads(raw_value)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]

            return [item.strip() for item in raw_value.split(",") if item.strip()]

        if isinstance(value, (list, tuple, set)):
            return [str(item).strip() for item in value if str(item).strip()]

        raise TypeError("CORS_ALLOW_ORIGINS must be a comma-separated string or list")


@lru_cache
def get_settings() -> Settings:
    return Settings()
