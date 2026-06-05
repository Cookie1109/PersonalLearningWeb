from __future__ import annotations

import logging
from time import perf_counter
from uuid import uuid4

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.request_context import reset_request_id, set_request_id

REQUEST_ID_HEADER = "X-Request-ID"
logger = logging.getLogger("app.request")


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        inbound_request_id = request.headers.get(REQUEST_ID_HEADER)
        request_id = inbound_request_id.strip() if inbound_request_id else str(uuid4())

        context_token = set_request_id(request_id)
        request.state.request_id = request_id

        started_at = perf_counter()
        response: Response | None = None

        try:
            response = await call_next(request)
            return response
        finally:
            duration_ms = round((perf_counter() - started_at) * 1000, 2)
            status_code = response.status_code if response is not None else 500

            logger.info(
                "http.request",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": duration_ms,
                    "status_code": status_code,
                },
            )

            if response is not None:
                response.headers[REQUEST_ID_HEADER] = request_id

            reset_request_id(context_token)


class IdempotencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method != "POST":
            return await call_next(request)

        idempotency_key = request.headers.get("Idempotency-Key")
        if not idempotency_key:
            return await call_next(request)

        idempotency_key = idempotency_key.strip()
        if not idempotency_key:
            return await call_next(request)

        redis_key = f"idempotency:{idempotency_key}"
        from app.infra.redis_client import get_redis_client
        import json

        redis_client = get_redis_client()
        ttl = 86400  # 24 hours

        # Try to lock/acquire the idempotency key using setnx
        is_new = redis_client.set(
            redis_key,
            json.dumps({"status": "processing"}),
            ex=ttl,
            nx=True
        )

        if not is_new:
            # Key already exists
            cached_data_str = redis_client.get(redis_key)
            if cached_data_str:
                try:
                    cached_data = json.loads(cached_data_str)
                    status = cached_data.get("status")
                    if status == "processing":
                        return Response(
                            content=json.dumps({
                                "message": "Yeu cau dang duoc xu ly.",
                                "detail": {"code": "IDEMPOTENCY_PROCESSING"}
                            }),
                            status_code=409,
                            media_type="application/json"
                        )
                    elif status == "completed":
                        cached_resp = cached_data.get("response", {})
                        headers = cached_resp.get("headers", {})
                        headers["X-Cache-Lookup"] = "HIT - Idempotency"
                        return Response(
                            content=cached_resp.get("body", ""),
                            status_code=cached_resp.get("status_code", 200),
                            headers=headers,
                            media_type=cached_resp.get("media_type")
                        )
                except Exception:
                    # If JSON parsing or reading failed, delete the key so it can be retried
                    redis_client.delete(redis_key)

        try:
            response = await call_next(request)

            # Skip caching if it is a streaming response
            if response.headers.get("content-type") == "text/event-stream" or response.media_type == "text/event-stream":
                redis_client.delete(redis_key)
                return response

            # Read response body and reconstruct response
            response_body = b""
            async for chunk in response.body_iterator:
                response_body += chunk

            reconstructed_response = Response(
                content=response_body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type
            )

            # Cache successful and client-error responses, but not server errors
            if response.status_code < 500:
                cached_payload = {
                    "status": "completed",
                    "response": {
                        "status_code": response.status_code,
                        "body": response_body.decode("utf-8", errors="replace"),
                        "headers": {k: v for k, v in response.headers.items() if k.lower() not in ("content-length", "date", "connection")},
                        "media_type": response.media_type
                    }
                }
                redis_client.set(redis_key, json.dumps(cached_payload), ex=ttl)
            else:
                redis_client.delete(redis_key)

            return reconstructed_response

        except Exception as e:
            redis_client.delete(redis_key)
            raise e

