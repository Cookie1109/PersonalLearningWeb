from __future__ import annotations

import json
import time

from redis import Redis
from redis.exceptions import RedisError

from app.core.exceptions import AppException


class FlashcardGenerationRateLimitStore:
    def __init__(self, redis_client: Redis, *, max_requests: int, window_seconds: int) -> None:
        self.redis = redis_client
        self.max_requests = max(1, int(max_requests))
        self.window_seconds = max(1, int(window_seconds))

    def _key(self, *, user_id: int, document_id: int) -> str:
        return f"flashcard:generation:limit:{user_id}:{document_id}"

    def _read_hits(self, *, user_id: int, document_id: int) -> list[int]:
        key = self._key(user_id=user_id, document_id=document_id)
        try:
            raw = self.redis.get(key)
        except RedisError as exc:
            raise AppException(
                status_code=503,
                message="Flashcard rate limit storage unavailable",
                detail={"code": "REDIS_UNAVAILABLE"},
            ) from exc

        if raw is None:
            return []

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return []

        hits_payload = payload.get("hits") if isinstance(payload, dict) else []
        if not isinstance(hits_payload, list):
            return []

        hits: list[int] = []
        for value in hits_payload:
            try:
                hits.append(int(value))
            except (TypeError, ValueError):
                continue
        return hits

    def enforce_or_raise(self, *, user_id: int, document_id: int) -> None:
        now = int(time.time())
        window_start = now - self.window_seconds

        hits = [
            timestamp
            for timestamp in self._read_hits(user_id=user_id, document_id=document_id)
            if timestamp > window_start
        ]

        if len(hits) >= self.max_requests:
            oldest_hit = min(hits)
            retry_after_seconds = max(1, self.window_seconds - (now - oldest_hit))
            raise AppException(
                status_code=429,
                message="Flashcard generation rate limit exceeded",
                detail={
                    "code": "FLASHCARD_GENERATION_RATE_LIMITED",
                    "retry_after_seconds": str(retry_after_seconds),
                    "limit": str(self.max_requests),
                    "window_seconds": str(self.window_seconds),
                },
            )

        hits.append(now)

        key = self._key(user_id=user_id, document_id=document_id)
        payload = json.dumps({"hits": hits})
        try:
            self.redis.setex(key, self.window_seconds, payload)
        except RedisError as exc:
            raise AppException(
                status_code=503,
                message="Flashcard rate limit storage unavailable",
                detail={"code": "REDIS_UNAVAILABLE"},
            ) from exc


class FlashcardExplainRateLimitStore:
    def __init__(self, redis_client: Redis, *, max_requests: int, window_seconds: int) -> None:
        self.redis = redis_client
        self.max_requests = max(1, int(max_requests))
        self.window_seconds = max(1, int(window_seconds))

    def _key(self, *, user_id: int) -> str:
        return f"flashcard:explain:limit:{user_id}"

    def _read_hits(self, *, user_id: int) -> list[int]:
        key = self._key(user_id=user_id)
        try:
            raw = self.redis.get(key)
        except RedisError as exc:
            raise AppException(
                status_code=503,
                message="Flashcard rate limit storage unavailable",
                detail={"code": "REDIS_UNAVAILABLE"},
            ) from exc

        if raw is None:
            return []

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return []

        hits_payload = payload.get("hits") if isinstance(payload, dict) else []
        if not isinstance(hits_payload, list):
            return []

        hits: list[int] = []
        for value in hits_payload:
            try:
                hits.append(int(value))
            except (TypeError, ValueError):
                continue
        return hits

    def enforce_or_raise(self, *, user_id: int) -> None:
        now = int(time.time())
        window_start = now - self.window_seconds

        hits = [timestamp for timestamp in self._read_hits(user_id=user_id) if timestamp > window_start]

        if len(hits) >= self.max_requests:
            oldest_hit = min(hits)
            retry_after_seconds = max(1, self.window_seconds - (now - oldest_hit))
            raise AppException(
                status_code=429,
                message="Flashcard explain rate limit exceeded",
                detail={
                    "code": "FLASHCARD_EXPLAIN_RATE_LIMITED",
                    "retry_after_seconds": str(retry_after_seconds),
                    "limit": str(self.max_requests),
                    "window_seconds": str(self.window_seconds),
                },
            )

        hits.append(now)

        key = self._key(user_id=user_id)
        payload = json.dumps({"hits": hits})
        try:
            self.redis.setex(key, self.window_seconds, payload)
        except RedisError as exc:
            raise AppException(
                status_code=503,
                message="Flashcard rate limit storage unavailable",
                detail={"code": "REDIS_UNAVAILABLE"},
            ) from exc
