from __future__ import annotations

import json
import time

from redis import Redis
from redis.exceptions import RedisError

from app.core.exceptions import AppException


class QuizCooldownStore:
    def __init__(
        self,
        redis_client: Redis,
        *,
        fail_4_5_seconds: int,
        fail_6_plus_seconds: int,
        state_ttl_seconds: int,
    ) -> None:
        self.redis = redis_client
        self.fail_4_5_seconds = fail_4_5_seconds
        self.fail_6_plus_seconds = fail_6_plus_seconds
        self.state_ttl_seconds = state_ttl_seconds

    def _key(self, *, user_id: int, quiz_id: str) -> str:
        return f"quiz:cooldown:{user_id}:{quiz_id}"

    def _read_state(self, *, user_id: int, quiz_id: str) -> dict:
        key = self._key(user_id=user_id, quiz_id=quiz_id)
        try:
            raw = self.redis.get(key)
        except RedisError as exc:
            raise AppException(status_code=503, message="Cooldown storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        if raw is None:
            return {"failed_attempts": 0, "lockout_until": 0}

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return {"failed_attempts": 0, "lockout_until": 0}

        return {
            "failed_attempts": int(payload.get("failed_attempts", 0)),
            "lockout_until": int(payload.get("lockout_until", 0)),
        }

    def enforce_or_raise(self, *, user_id: int, quiz_id: str) -> None:
        state = self._read_state(user_id=user_id, quiz_id=quiz_id)
        now = int(time.time())
        lockout_until = state["lockout_until"]

        if lockout_until > now:
            retry_after = lockout_until - now
            raise AppException(
                status_code=429,
                message="Quiz is in cooldown period",
                detail={
                    "code": "QUIZ_COOLDOWN_ACTIVE",
                    "retry_after_seconds": str(retry_after),
                },
            )

    def register_failure(self, *, user_id: int, quiz_id: str) -> int:
        state = self._read_state(user_id=user_id, quiz_id=quiz_id)
        failed_attempts = state["failed_attempts"] + 1

        if failed_attempts <= 3:
            cooldown_seconds = 0
        elif failed_attempts <= 5:
            cooldown_seconds = self.fail_4_5_seconds
        else:
            cooldown_seconds = self.fail_6_plus_seconds

        lockout_until = int(time.time()) + cooldown_seconds if cooldown_seconds > 0 else 0
        payload = {
            "failed_attempts": failed_attempts,
            "lockout_until": lockout_until,
        }

        key = self._key(user_id=user_id, quiz_id=quiz_id)
        try:
            self.redis.setex(key, self.state_ttl_seconds, json.dumps(payload))
        except RedisError as exc:
            raise AppException(status_code=503, message="Cooldown storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        return cooldown_seconds

    def reset(self, *, user_id: int, quiz_id: str) -> None:
        key = self._key(user_id=user_id, quiz_id=quiz_id)
        try:
            self.redis.delete(key)
        except RedisError as exc:
            raise AppException(status_code=503, message="Cooldown storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc
