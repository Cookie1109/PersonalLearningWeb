from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.exceptions import AppException

logger = logging.getLogger("app.flashcard_generation")

FLASHCARD_FALLBACK_MODELS: tuple[str, ...] = (
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
)
FLASHCARD_MAX_OUTPUT_TOKENS = 8192

FLASHCARD_SYSTEM_PROMPT = """
Bạn là một chuyên gia phân tích dữ liệu giáo dục. Nhiệm vụ của bạn là đọc toàn bộ văn bản được cung cấp và trích xuất TRIỆT ĐỂ mọi thông tin quan trọng để tạo Flashcard (Thẻ nhớ).

Tiêu chí xác định nội dung trọng tâm:
- Phải bao gồm mọi khái niệm cốt lõi, định nghĩa, hoặc thuật ngữ.
- Phải bao gồm các mốc thời gian, sự kiện lịch sử, hoặc nhân vật quan trọng.
- Phải bao gồm các nguyên nhân, kết quả, hoặc đặc điểm cấu trúc được liệt kê trong bài.

Quy tắc về số lượng và định dạng:
- TUYỆT ĐỐI KHÔNG tự ý giới hạn số lượng thẻ (không dừng ở 10 hay 15 thẻ). Văn bản có bao nhiêu ý quan trọng, phải tạo bấy nhiêu thẻ tương ứng. (Có thể lên tới 50-100 thẻ nếu văn bản dài).
- Trả về đúng định dạng JSON Array: [{"front": "...", "back": "..."}].
- Mặt trước (front): Ngắn gọn (tối đa 15 chữ), là câu hỏi hoặc từ khóa.
- Mặt sau (back): Đầy đủ ý nghĩa, chính xác, không lan man.
""".strip()

CODE_FENCE_PATTERN = re.compile(r"```(?:json)?\\s*(.*?)\\s*```", re.IGNORECASE | re.DOTALL)


@dataclass(frozen=True)
class GeneratedFlashcard:
    front_text: str
    back_text: str


def _normalize_model_name(raw_model: str) -> str:
    model = (raw_model or "").strip()
    if model.startswith("models/"):
        model = model.split("/", 1)[1]

    legacy_map = {
        "gemini-1.5-flash": "gemini-2.5-flash",
        "gemini-1.5-pro": "gemini-2.5-pro",
    }
    return legacy_map.get(model, model)


def _build_model_candidates(settings) -> list[str]:
    configured_flash_model = (settings.gemini_model or "").strip() or "gemini-2.5-flash"
    configured_pro_model = (settings.gemini_pro_model or "").strip() or "gemini-2.5-flash"

    candidates: list[str] = []
    for candidate in (
        configured_flash_model,
        _normalize_model_name(configured_flash_model),
        configured_pro_model,
        _normalize_model_name(configured_pro_model),
        *FLASHCARD_FALLBACK_MODELS,
    ):
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    return candidates


def _extract_gemini_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""

    candidate = candidates[0]
    if not isinstance(candidate, dict):
        return ""

    content = candidate.get("content")
    if not isinstance(content, dict):
        return ""

    parts = content.get("parts")
    if not isinstance(parts, list):
        return ""

    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            chunks.append(text.strip())

    return "\n\n".join(chunks).strip()


def _extract_provider_error_message(response: httpx.Response) -> str | None:
    try:
        response_payload = response.json()
    except ValueError:
        return None

    if not isinstance(response_payload, dict):
        return None

    error_payload = response_payload.get("error")
    if not isinstance(error_payload, dict):
        return None

    message = error_payload.get("message")
    if isinstance(message, str) and message.strip():
        return message.strip()

    status = error_payload.get("status")
    if isinstance(status, str) and status.strip():
        return status.strip()

    return None


def _extract_json_candidate_text(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if not text:
        return ""

    if text.startswith("```"):
        block_match = CODE_FENCE_PATTERN.search(text)
        if block_match:
            text = block_match.group(1).strip()

    array_start = text.find("[")
    array_end = text.rfind("]")
    if array_start != -1 and array_end != -1 and array_end > array_start:
        return text[array_start : array_end + 1]

    object_start = text.find("{")
    object_end = text.rfind("}")
    if object_start != -1 and object_end != -1 and object_end > object_start:
        return text[object_start : object_end + 1]

    return text


def _extract_flashcard_items(raw_payload: Any) -> list[Any] | None:
    if isinstance(raw_payload, list):
        return raw_payload

    if not isinstance(raw_payload, dict):
        return None

    for key in ("flashcards", "cards", "items", "data"):
        value = raw_payload.get(key)
        if isinstance(value, list):
            return value

    return None


def _build_generation_payload(*, user_prompt: str) -> dict[str, Any]:
    return {
        "systemInstruction": {
            "role": "user",
            "parts": [{"text": FLASHCARD_SYSTEM_PROMPT}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": FLASHCARD_MAX_OUTPUT_TOKENS,
            "responseMimeType": "application/json",
        },
    }


def build_flashcard_prompt(*, lesson_title: str, document_text: str) -> str:
    source_text = (document_text or "").strip()
    return (
        "INPUT SOURCE:\n"
        f"- Document title: {lesson_title.strip()}\n"
        "- Truth source (document_text):\n"
        f"{source_text}"
    )


def parse_generated_flashcards(raw_text: str) -> list[GeneratedFlashcard]:
    text = _extract_json_candidate_text((raw_text or "").strip())
    if not text:
        raise ValueError("Empty model output")

    raw_payload = json.loads(text)
    items = _extract_flashcard_items(raw_payload)
    if items is None:
        raise ValueError("Flashcard payload must be a JSON array or an object with cards")

    normalized: list[GeneratedFlashcard] = []
    seen_pairs: set[tuple[str, str]] = set()
    for item in items:
        if not isinstance(item, dict):
            continue

        front_raw = item.get("front")
        if not isinstance(front_raw, str):
            front_raw = item.get("front_text")

        back_raw = item.get("back")
        if not isinstance(back_raw, str):
            back_raw = item.get("back_text")

        front_text = str(front_raw or "").strip()
        back_text = str(back_raw or "").strip()
        if not front_text or not back_text:
            continue

        key = (front_text.casefold(), back_text.casefold())
        if key in seen_pairs:
            continue
        seen_pairs.add(key)

        normalized.append(
            GeneratedFlashcard(
                front_text=front_text,
                back_text=back_text,
            )
        )

    if len(normalized) < 4:
        raise ValueError("Flashcard payload must contain at least 4 valid cards")

    return normalized


def generate_flashcards(*, lesson_title: str, document_text: str) -> tuple[str, list[GeneratedFlashcard]]:
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        raise AppException(
            status_code=503,
            message="AI service is not configured",
            detail={"code": "LLM_API_KEY_MISSING"},
        )

    model_candidates = _build_model_candidates(settings)
    timeout_seconds = max(30.0, float(settings.gemini_timeout_seconds))

    user_prompt = build_flashcard_prompt(lesson_title=lesson_title, document_text=document_text)
    request_payload = _build_generation_payload(user_prompt=user_prompt)
    saw_quota_or_rate_limit = False
    latest_quota_message: str | None = None
    last_ai_error: AppException | None = None

    with httpx.Client(timeout=timeout_seconds) as client:
        for index, model_name in enumerate(model_candidates):
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            has_fallback = index < len(model_candidates) - 1

            try:
                response = client.post(endpoint, params={"key": api_key}, json=request_payload)
            except httpx.TimeoutException:
                if has_fallback:
                    continue
                last_ai_error = AppException(status_code=503, message="AI service timeout", detail={"code": "LLM_TIMEOUT"})
                break
            except httpx.RequestError:
                if has_fallback:
                    continue
                last_ai_error = AppException(status_code=503, message="AI service network error", detail={"code": "LLM_NETWORK_ERROR"})
                break

            if response.status_code in (401, 403):
                last_ai_error = AppException(
                    status_code=503,
                    message="AI service authentication failed",
                    detail={"code": "LLM_AUTH_FAILED"},
                )
                break

            provider_error_message = _extract_provider_error_message(response)

            if response.status_code == 429:
                saw_quota_or_rate_limit = True
                latest_quota_message = provider_error_message or latest_quota_message

                if has_fallback:
                    logger.warning(
                        "flashcard_generation.rate_limited_try_fallback model=%s error=%s",
                        model_name,
                        provider_error_message,
                    )
                    continue

                last_ai_error = AppException(
                    status_code=503,
                    message="AI quota exceeded",
                    detail={
                        "code": "LLM_QUOTA_EXCEEDED",
                        "status_code": str(response.status_code),
                        "provider_message": provider_error_message,
                    },
                )
                break

            if response.status_code >= 400:
                if has_fallback and response.status_code in (404, 500, 503):
                    continue

                last_ai_error = AppException(
                    status_code=503,
                    message="AI service unavailable",
                    detail={
                        "code": "LLM_SERVICE_ERROR",
                        "status_code": str(response.status_code),
                        "provider_message": provider_error_message,
                    },
                )
                break

            try:
                response_json = response.json()
            except ValueError:
                if has_fallback:
                    continue
                last_ai_error = AppException(
                    status_code=503,
                    message="AI service returned invalid response",
                    detail={"code": "LLM_INVALID_RESPONSE"},
                )
                break

            generated_text = _extract_gemini_text(response_json)
            if not generated_text:
                if has_fallback:
                    continue
                last_ai_error = AppException(
                    status_code=503,
                    message="AI service returned empty response",
                    detail={"code": "LLM_EMPTY_RESPONSE"},
                )
                break

            try:
                cards = parse_generated_flashcards(generated_text)
                return model_name, cards
            except (ValueError, json.JSONDecodeError) as exc:
                if has_fallback:
                    logger.warning(
                        "flashcard_generation.invalid_json_try_fallback model=%s error=%s",
                        model_name,
                        str(exc),
                    )
                    continue

                last_ai_error = AppException(
                    status_code=500,
                    message="AI service returned invalid flashcard JSON",
                    detail={"code": "LLM_INVALID_FLASHCARD_JSON", "error": str(exc)},
                )
                break

    if saw_quota_or_rate_limit:
        raise AppException(
            status_code=503,
            message="AI quota exceeded",
            detail={
                "code": "LLM_QUOTA_EXCEEDED",
                "provider_message": latest_quota_message,
            },
        )

    if last_ai_error is not None:
        raise last_ai_error

    raise AppException(status_code=503, message="AI service unavailable", detail={"code": "LLM_SERVICE_ERROR"})
