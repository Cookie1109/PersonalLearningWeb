from functools import lru_cache
from pathlib import Path

from pydantic import Field
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

    database_url: str = Field(
        default="mysql+pymysql://root:root@localhost:3306/personal_learning",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")

    jwt_secret_key: str = Field(default="change-me", alias="JWT_SECRET_KEY")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(default=15, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_days: int = Field(default=30, alias="REFRESH_TOKEN_EXPIRE_DAYS")
    refresh_cookie_name: str = Field(default="refresh_token", alias="REFRESH_COOKIE_NAME")
    idempotency_ttl_seconds: int = Field(default=86400, alias="IDEMPOTENCY_TTL_SECONDS")
    lesson_complete_reward_exp: int = Field(default=50, alias="LESSON_COMPLETE_REWARD_EXP")
    quiz_pass_score: int = Field(default=80, alias="QUIZ_PASS_SCORE")
    quiz_first_pass_reward_type: str = Field(default="quiz_first_pass", alias="QUIZ_FIRST_PASS_REWARD_TYPE")
    quiz_cooldown_fail_4_5_seconds: int = Field(default=30, alias="QUIZ_COOLDOWN_FAIL_4_5_SECONDS")
    quiz_cooldown_fail_6_plus_seconds: int = Field(default=60, alias="QUIZ_COOLDOWN_FAIL_6_PLUS_SECONDS")
    quiz_cooldown_state_ttl_seconds: int = Field(default=86400, alias="QUIZ_COOLDOWN_STATE_TTL_SECONDS")
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-1.5-flash", alias="GEMINI_MODEL")
    gemini_pro_model: str = Field(default="gemini-2.5-pro", alias="GEMINI_PRO_MODEL")
    gemini_timeout_seconds: float = Field(default=120.0, alias="GEMINI_TIMEOUT_SECONDS")
    youtube_api_key: str | None = Field(default=None, alias="YOUTUBE_API_KEY")


@lru_cache
def get_settings() -> Settings:
    return Settings()
