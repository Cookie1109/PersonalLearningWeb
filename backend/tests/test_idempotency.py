import pytest
from uuid import uuid4

def test_idempotency_returns_cached_response_for_repeated_key(client, auth_headers) -> None:
    _, headers = auth_headers
    idempotency_key = f"test-key-{uuid4()}"
    headers_with_key = {**headers, "Idempotency-Key": idempotency_key}

    payload = {
        "action_type": "READ_DOCUMENT",
        "target_id": "test-doc-123",
        "value": 1
    }

    # First call - should proceed and get status 200
    response1 = client.post("/api/gamification/track", json=payload, headers=headers_with_key)
    assert response1.status_code == 200
    res1_json = response1.json()

    # Second call with same key - should hit idempotency cache and return identical response
    response2 = client.post("/api/gamification/track", json=payload, headers=headers_with_key)
    assert response2.status_code == 200
    assert response2.headers.get("X-Cache-Lookup") == "HIT - Idempotency"
    assert response2.json() == res1_json


def test_idempotency_concurrent_processing_returns_409(client, auth_headers, monkeypatch) -> None:
    _, headers = auth_headers
    idempotency_key = f"test-key-{uuid4()}"
    headers_with_key = {**headers, "Idempotency-Key": idempotency_key}

    payload = {
        "action_type": "READ_DOCUMENT",
        "target_id": "test-doc-456",
        "value": 1
    }


    # Simulate key already in Redis with status "processing"
    from app.infra.redis_client import get_redis_client
    import json

    redis_client = get_redis_client()
    redis_key = f"idempotency:{idempotency_key}"
    redis_client.set(redis_key, json.dumps({"status": "processing"}), ex=60)

    try:
        response = client.post("/api/gamification/track", json=payload, headers=headers_with_key)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "IDEMPOTENCY_PROCESSING"
    finally:
        redis_client.delete(redis_key)
