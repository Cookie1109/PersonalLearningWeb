from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.infra.redis_client import get_redis_client
from app.main import create_app
from app.models import Lesson, Question, Quiz, Roadmap, User


class FakeRedisPipeline:
    def __init__(self, redis: "FakeRedis") -> None:
        self.redis = redis

    def setex(self, key: str, ttl_seconds: int, value: str) -> "FakeRedisPipeline":
        self.redis.setex(key, ttl_seconds, value)
        return self

    def sadd(self, key: str, *values: str) -> "FakeRedisPipeline":
        self.redis.sadd(key, *values)
        return self

    def expire(self, key: str, ttl_seconds: int) -> "FakeRedisPipeline":
        self.redis.expire(key, ttl_seconds)
        return self

    def execute(self) -> list[object]:
        return []


class FakeRedis:
    def __init__(self) -> None:
        self.kv_store: dict[str, str] = {}
        self.set_store: dict[str, set[str]] = {}

    def get(self, key: str) -> str | None:
        return self.kv_store.get(key)

    def setex(self, key: str, ttl_seconds: int, value: str) -> bool:
        _ = ttl_seconds
        self.kv_store[key] = value
        return True

    def set(self, key: str, value: str, nx: bool = False, ex: int | None = None) -> bool:
        _ = ex
        if nx and key in self.kv_store:
            return False
        self.kv_store[key] = value
        return True

    def delete(self, key: str) -> int:
        removed = 0
        if key in self.kv_store:
            del self.kv_store[key]
            removed = 1
        if key in self.set_store:
            del self.set_store[key]
            removed = 1
        return removed

    def pipeline(self) -> FakeRedisPipeline:
        return FakeRedisPipeline(self)

    def sadd(self, key: str, *values: str) -> int:
        bucket = self.set_store.setdefault(key, set())
        before = len(bucket)
        for value in values:
            bucket.add(str(value))
        return len(bucket) - before

    def smembers(self, key: str) -> set[str]:
        return set(self.set_store.get(key, set()))

    def expire(self, key: str, ttl_seconds: int) -> bool:
        _ = (key, ttl_seconds)
        return True


@pytest.fixture(scope="session")
def engine():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="session")
def session_factory(engine):
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def reset_schema(engine) -> Generator[None, None, None]:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def db_session(session_factory) -> Generator[Session, None, None]:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest.fixture
def client(db_session: Session, fake_redis: FakeRedis, monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    import app.services.auth_service as auth_service
    import app.api.routes.auth as auth_routes
    import app.api.routes.lessons as lessons_routes
    import app.api.routes.quizzes as quizzes_routes

    monkeypatch.setattr(auth_service, "verify_password", lambda plain, saved: plain == saved)
    monkeypatch.setattr(auth_routes, "queue_audit_log", lambda *args, **kwargs: None)
    monkeypatch.setattr(lessons_routes, "queue_audit_log", lambda *args, **kwargs: None)
    monkeypatch.setattr(quizzes_routes, "queue_audit_log", lambda *args, **kwargs: None)

    app = create_app()

    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_redis_client] = lambda: fake_redis

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture
def create_user(db_session: Session):
    def _create_user(
        *,
        email: str = "learner@example.com",
        password: str = "StrongPass123!",
        display_name: str = "Learner",
    ) -> tuple[User, str]:
        user = User(
            email=email,
            password_hash=password,
            display_name=display_name,
            level=1,
            exp=0,
            total_exp=0,
            current_streak=0,
            streak=0,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        return user, password

    return _create_user


@pytest.fixture
def auth_headers(create_user):
    user, _ = create_user()
    access_token, _ = create_access_token(user_id=user.id, email=user.email)
    return user, {"Authorization": f"Bearer {access_token}"}


@pytest.fixture
def seed_quiz(db_session: Session, auth_headers):
    user, _ = auth_headers

    roadmap = Roadmap(
        user_id=user.id,
        goal="Master backend testing",
        title="Backend Mastery",
        is_active=True,
    )
    db_session.add(roadmap)
    db_session.commit()
    db_session.refresh(roadmap)

    lesson = Lesson(
        user_id=user.id,
        roadmap_id=roadmap.id,
        week_number=1,
        position=1,
        title="Quiz Fundamentals",
        source_content="Quiz fundamentals source content for testing.",
    )
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)

    quiz = Quiz(
        lesson_id=lesson.id,
        model_name="gemini-1.5-flash",
    )
    db_session.add(quiz)
    db_session.commit()
    db_session.refresh(quiz)

    db_session.add_all(
        [
            Question(
                quiz_id=quiz.id,
                question_text="Question 1",
                options_json=["A1", "B1", "C1", "D1"],
                correct_index=1,
                explanation="q1 explanation",
                position=1,
            ),
            Question(
                quiz_id=quiz.id,
                question_text="Question 2",
                options_json=["A2", "B2", "C2", "D2"],
                correct_index=2,
                explanation="q2 explanation",
                position=2,
            ),
        ]
    )
    db_session.commit()

    return user, str(quiz.id), lesson.id
