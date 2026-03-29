from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Literal

from redis import Redis
from redis.exceptions import RedisError

from app.core.exceptions import AppException

IdempotencyState = Literal["started", "completed", "in_progress"]


class IdempotencyStore:
    def __init__(self, redis_client: Redis, *, ttl_seconds: int) -> None:
        self.redis = redis_client
        self.ttl_seconds = ttl_seconds

    def _read_json(self, raw: str | None) -> dict | None:
        if raw is None:
            return None
        return json.loads(raw)

    def build_lesson_complete_key(self, *, user_id: int, lesson_id: int, idempotency_key: str) -> str:
        return f"idempotency:lesson_complete:{user_id}:{lesson_id}:{idempotency_key}"

    def begin(self, key: str) -> tuple[IdempotencyState, dict | None]:
        payload = {
            "status": "IN_PROGRESS",
            "updated_at": datetime.now(UTC).isoformat(),
        }

        try:
            created = self.redis.set(key, json.dumps(payload), nx=True, ex=self.ttl_seconds)
        except RedisError as exc:
            raise AppException(status_code=503, message="Idempotency storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        if created:
            return "started", None

        try:
            existing_raw = self.redis.get(key)
        except RedisError as exc:
            raise AppException(status_code=503, message="Idempotency storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        existing = self._read_json(existing_raw)
        if existing is None:
            return "in_progress", None

        if existing.get("status") == "COMPLETED":
            return "completed", existing.get("response")

        return "in_progress", None

    def complete(self, key: str, response_payload: dict) -> None:
        payload = {
            "status": "COMPLETED",
            "updated_at": datetime.now(UTC).isoformat(),
            "response": response_payload,
        }

        try:
            self.redis.set(key, json.dumps(payload), ex=self.ttl_seconds)
        except RedisError as exc:
            raise AppException(status_code=503, message="Idempotency storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

    def release(self, key: str) -> None:
        try:
            existing_raw = self.redis.get(key)
        except RedisError as exc:
            raise AppException(status_code=503, message="Idempotency storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        existing = self._read_json(existing_raw)
        if existing and existing.get("status") == "IN_PROGRESS":
            try:
                self.redis.delete(key)
            except RedisError as exc:
                raise AppException(status_code=503, message="Idempotency storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc
