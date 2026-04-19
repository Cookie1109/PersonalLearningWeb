from __future__ import annotations

from collections.abc import Generator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.exceptions import AppException
from app.db.base import Base
from app.db.session import get_db
from app.infra.redis_client import get_redis_client
from app.main import create_app
from app.models import Lesson, Question, Quiz, Roadmap, User

TEST_FIREBASE_TOKEN_PREFIX = "test-firebase-token"


def build_test_firebase_token(*, firebase_uid: str, email: str) -> str:
    return f"{TEST_FIREBASE_TOKEN_PREFIX}|{firebase_uid}|{email.strip().lower()}"


def build_test_auth_headers(*, firebase_uid: str, email: str) -> dict[str, str]:
    token = build_test_firebase_token(firebase_uid=firebase_uid, email=email)
    return {"Authorization": f"Bearer {token}"}


def _fake_verify_firebase_id_token(token: str) -> dict[str, object]:
    parts = token.split("|", maxsplit=2)
    if len(parts) != 3 or parts[0] != TEST_FIREBASE_TOKEN_PREFIX:
        raise AppException(
            status_code=401,
            message="Invalid Firebase ID token",
            detail={"code": "FIREBASE_ID_TOKEN_INVALID"},
        )

    uid = parts[1].strip()
    email = parts[2].strip().lower()
    if not uid or not email:
        raise AppException(
            status_code=401,
            message="Invalid Firebase ID token",
            detail={"code": "FIREBASE_ID_TOKEN_INVALID"},
        )

    return {
        "uid": uid,
        "email": email,
        "name": email.split("@")[0],
    }


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
    import app.api.deps.auth as deps_auth
    import app.api.routes.lessons as lessons_routes
    import app.api.routes.quizzes as quizzes_routes

    monkeypatch.setattr(deps_auth, "verify_firebase_id_token", _fake_verify_firebase_id_token)
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
        firebase_uid: str | None = None,
    ) -> tuple[User, str]:
        resolved_email = email.strip().lower()
        resolved_uid = firebase_uid or f"uid-{uuid4().hex[:16]}"
        user = User(
            email=resolved_email,
            firebase_uid=resolved_uid,
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
    return user, build_test_auth_headers(firebase_uid=user.firebase_uid or "", email=user.email)


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
