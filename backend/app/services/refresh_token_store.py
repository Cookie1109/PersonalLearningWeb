from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.core.security import generate_refresh_token, hash_refresh_token


class RefreshTokenStore:
    def __init__(self, redis_client: Redis) -> None:
        self.redis = redis_client
        self.settings = get_settings()

    def _token_ttl_seconds(self) -> int:
        return self.settings.refresh_token_expire_days * 24 * 60 * 60

    def _token_key(self, token_hash: str) -> str:
        return f"auth:refresh:token:{token_hash}"

    def _family_key(self, family_id: str) -> str:
        return f"auth:refresh:family:{family_id}"

    def _user_families_key(self, user_id: int) -> str:
        return f"auth:refresh:user_families:{user_id}"

    def _load_json(self, raw: str | None) -> dict | None:
        if raw is None:
            return None
        return json.loads(raw)

    def issue_token(self, *, user_id: int, device_id: str | None = None) -> str:
        family_id = str(uuid4())
        jti = str(uuid4())
        refresh_token = generate_refresh_token()
        token_hash = hash_refresh_token(refresh_token)
        now_iso = datetime.now(UTC).isoformat()
        ttl = self._token_ttl_seconds()

        family_payload = {
            "family_id": family_id,
            "user_id": user_id,
            "device_id": device_id,
            "current_jti": jti,
            "revoked": False,
            "updated_at": now_iso,
        }
        token_payload = {
            "user_id": user_id,
            "family_id": family_id,
            "jti": jti,
            "device_id": device_id,
            "status": "active",
            "issued_at": now_iso,
            "replaced_by": None,
        }

        try:
            pipe = self.redis.pipeline()
            pipe.setex(self._family_key(family_id), ttl, json.dumps(family_payload))
            pipe.setex(self._token_key(token_hash), ttl, json.dumps(token_payload))
            pipe.sadd(self._user_families_key(user_id), family_id)
            pipe.expire(self._user_families_key(user_id), ttl)
            pipe.execute()
        except RedisError as exc:
            raise AppException(status_code=503, message="Auth storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        return refresh_token

    def rotate_token(self, refresh_token: str, *, device_id: str | None = None) -> tuple[int, str]:
        token_hash = hash_refresh_token(refresh_token)
        ttl = self._token_ttl_seconds()

        try:
            raw_token = self.redis.get(self._token_key(token_hash))
        except RedisError as exc:
            raise AppException(status_code=503, message="Auth storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        token_payload = self._load_json(raw_token)
        if token_payload is None:
            raise AppException(status_code=401, message="Invalid refresh token", detail={"code": "REFRESH_TOKEN_INVALID"})

        family_id = token_payload["family_id"]

        try:
            raw_family = self.redis.get(self._family_key(family_id))
        except RedisError as exc:
            raise AppException(status_code=503, message="Auth storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        family_payload = self._load_json(raw_family)
        if family_payload is None or family_payload.get("revoked"):
            raise AppException(status_code=401, message="Refresh token revoked", detail={"code": "REFRESH_TOKEN_REVOKED"})

        if token_payload.get("status") != "active":
            self.revoke_family(family_id, reason="replay_detected")
            raise AppException(status_code=401, message="Refresh token replay detected", detail={"code": "REFRESH_TOKEN_REPLAY"})

        if device_id and token_payload.get("device_id") and token_payload["device_id"] != device_id:
            self.revoke_family(family_id, reason="device_mismatch")
            raise AppException(status_code=403, message="Device mismatch", detail={"code": "REFRESH_TOKEN_DEVICE_MISMATCH"})

        new_jti = str(uuid4())
        new_refresh_token = generate_refresh_token()
        new_token_hash = hash_refresh_token(new_refresh_token)
        now_iso = datetime.now(UTC).isoformat()

        token_payload["status"] = "rotated"
        token_payload["replaced_by"] = new_jti
        token_payload["rotated_at"] = now_iso

        new_token_payload = {
            "user_id": token_payload["user_id"],
            "family_id": family_id,
            "jti": new_jti,
            "device_id": token_payload.get("device_id") or device_id,
            "status": "active",
            "issued_at": now_iso,
            "replaced_by": None,
        }

        family_payload["current_jti"] = new_jti
        family_payload["updated_at"] = now_iso

        try:
            pipe = self.redis.pipeline()
            pipe.setex(self._token_key(token_hash), ttl, json.dumps(token_payload))
            pipe.setex(self._token_key(new_token_hash), ttl, json.dumps(new_token_payload))
            pipe.setex(self._family_key(family_id), ttl, json.dumps(family_payload))
            pipe.execute()
        except RedisError as exc:
            raise AppException(status_code=503, message="Auth storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        return int(token_payload["user_id"]), new_refresh_token

    def revoke_family(self, family_id: str, *, reason: str = "manual_revoke") -> None:
        ttl = self._token_ttl_seconds()
        now_iso = datetime.now(UTC).isoformat()

        try:
            raw_family = self.redis.get(self._family_key(family_id))
        except RedisError as exc:
            raise AppException(status_code=503, message="Auth storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        family_payload = self._load_json(raw_family)
        if family_payload is None:
            return

        family_payload["revoked"] = True
        family_payload["reason"] = reason
        family_payload["updated_at"] = now_iso

        try:
            self.redis.setex(self._family_key(family_id), ttl, json.dumps(family_payload))
        except RedisError as exc:
            raise AppException(status_code=503, message="Auth storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

    def revoke_token_family_by_token(self, refresh_token: str) -> None:
        token_hash = hash_refresh_token(refresh_token)

        try:
            raw_token = self.redis.get(self._token_key(token_hash))
        except RedisError as exc:
            raise AppException(status_code=503, message="Auth storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        token_payload = self._load_json(raw_token)
        if token_payload is None:
            return

        self.revoke_family(token_payload["family_id"], reason="logout")

    def revoke_all_user_families(self, user_id: int) -> None:
        user_families_key = self._user_families_key(user_id)

        try:
            family_ids = self.redis.smembers(user_families_key)
        except RedisError as exc:
            raise AppException(status_code=503, message="Auth storage unavailable", detail={"code": "REDIS_UNAVAILABLE"}) from exc

        for family_id in family_ids:
            self.revoke_family(family_id, reason="logout_all_devices")
