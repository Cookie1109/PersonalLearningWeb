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
