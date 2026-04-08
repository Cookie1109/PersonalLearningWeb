from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.exceptions import AppException

CODE_FENCE_PATTERN = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.IGNORECASE | re.DOTALL)


@dataclass(frozen=True)
class GeneratedQuizQuestion:
    question: str
    options: list[str]
    correct_index: int
    explanation: str


def _normalize_model_name(raw_model: str) -> str:
    model = (raw_model or "").strip()
    if model.startswith("models/"):
        model = model.split("/", 1)[1]

    legacy_map = {
        "gemini-1.5-flash": "gemini-2.5-flash",
        "gemini-1.5-pro": "gemini-2.5-pro",
    }
    return legacy_map.get(model, model)


def _build_quiz_model_candidates(settings) -> list[str]:
    configured_quiz_model = (settings.gemini_quiz_model or "").strip() or "gemini-2.5-flash"
    configured_flash_model = (settings.gemini_model or "").strip() or "gemini-2.5-flash"

    candidates: list[str] = []
    for candidate in (
        configured_quiz_model,
        _normalize_model_name(configured_quiz_model),
        configured_flash_model,
        _normalize_model_name(configured_flash_model),
    ):
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    return candidates


def build_quiz_prompt(*, lesson_title: str, source_content: str) -> str:
    return (
        "Ban la tro ly hoc tap. Hay tao DUNG 3 cau hoi trac nghiem CHI dua tren tai lieu goc ben duoi. "
        "Tai lieu goc la nguon su that DUY NHAT. TUYET DOI KHONG dua kien thuc ben ngoai tai lieu. "
        "Moi cau hoi, dap an va explanation phai truy vet duoc tu tai lieu goc; khong duoc suy doan. "
        "Neu tai lieu goc thieu thong tin, van tao cau hoi o muc do co ban dua tren noi dung da co, "
        "khong chen su kien/khai niem moi khong xuat hien trong tai lieu. "
        "BAt BUOC: explanation phai neu can cu cu the tu tai lieu goc (trich y ngan gon). "
        "Tra ve dinh dang JSON mang tuyet doi nghiem ngat: "
        "[{ \"question\": \"...\", \"options\": [\"A\", \"B\", \"C\", \"D\"], \"correct_index\": 0, \"explanation\": \"...\" }]. "
        "Khong kem bat ky van ban nao khac ngoai JSON.\n\n"
        f"Tieu de tai lieu: {lesson_title.strip()}\n\n"
        "Tai lieu goc (nguon su that duy nhat):\n"
        f"{source_content.strip()[:40000]}"
    )


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


def sanitize_quiz_json_text(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if not text:
        raise ValueError("Empty model output")

    block_match = CODE_FENCE_PATTERN.search(text)
    if block_match:
        text = block_match.group(1).strip()

    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]

    return text


def parse_generated_quiz(raw_text: str) -> list[GeneratedQuizQuestion]:
    cleaned = sanitize_quiz_json_text(raw_text)
    payload = json.loads(cleaned)

    if not isinstance(payload, list):
        raise ValueError("Quiz payload must be a JSON array")
    if len(payload) != 3:
        raise ValueError("Quiz payload must contain exactly 3 questions")

    normalized: list[GeneratedQuizQuestion] = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("Each quiz item must be a JSON object")

        question = str(item.get("question", "")).strip()
        explanation = str(item.get("explanation", "")).strip()
        options_raw = item.get("options")
        correct_index = item.get("correct_index")

        if not question:
            raise ValueError("Question text is required")
        if not explanation:
            raise ValueError("Explanation is required")
        if not isinstance(options_raw, list) or len(options_raw) != 4:
            raise ValueError("Each question must contain exactly 4 options")

        options: list[str] = []
        for option in options_raw:
            option_text = str(option).strip()
            if not option_text:
                raise ValueError("Each option must be non-empty")
            options.append(option_text)

        if not isinstance(correct_index, int) or correct_index < 0 or correct_index > 3:
            raise ValueError("correct_index must be an integer between 0 and 3")

        normalized.append(
            GeneratedQuizQuestion(
                question=question,
                options=options,
                correct_index=correct_index,
                explanation=explanation,
            )
        )

    return normalized


def generate_quiz_questions(*, lesson_title: str, source_content: str) -> tuple[str, list[GeneratedQuizQuestion]]:
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        raise AppException(
            status_code=503,
            message="AI service is not configured",
            detail={"code": "LLM_API_KEY_MISSING"},
        )

    model_candidates = _build_quiz_model_candidates(settings)
    timeout_seconds = max(30.0, float(settings.gemini_timeout_seconds))

    request_payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": build_quiz_prompt(lesson_title=lesson_title, source_content=source_content),
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 3072,
        },
    }

    with httpx.Client(timeout=timeout_seconds) as client:
        for index, model_name in enumerate(model_candidates):
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            has_fallback = index < len(model_candidates) - 1

            try:
                response = client.post(endpoint, params={"key": api_key}, json=request_payload)
            except httpx.TimeoutException as exc:
                if has_fallback:
                    continue
                raise AppException(status_code=503, message="AI service timeout", detail={"code": "LLM_TIMEOUT"}) from exc
            except httpx.RequestError as exc:
                if has_fallback:
                    continue
                raise AppException(status_code=503, message="AI service network error", detail={"code": "LLM_NETWORK_ERROR"}) from exc

            if response.status_code in (401, 403):
                raise AppException(
                    status_code=503,
                    message="AI service authentication failed",
                    detail={"code": "LLM_AUTH_FAILED"},
                )

            if response.status_code >= 400:
                if has_fallback and response.status_code in (404, 429, 500, 503):
                    continue
                raise AppException(
                    status_code=503,
                    message="AI service unavailable",
                    detail={"code": "LLM_SERVICE_ERROR", "status_code": str(response.status_code)},
                )

            try:
                response_json = response.json()
            except ValueError as exc:
                if has_fallback:
                    continue
                raise AppException(
                    status_code=503,
                    message="AI service returned invalid response",
                    detail={"code": "LLM_INVALID_RESPONSE"},
                ) from exc

            generated_text = _extract_gemini_text(response_json)
            if not generated_text:
                if has_fallback:
                    continue
                raise AppException(
                    status_code=503,
                    message="AI service returned empty response",
                    detail={"code": "LLM_EMPTY_RESPONSE"},
                )

            try:
                questions = parse_generated_quiz(generated_text)
            except (ValueError, json.JSONDecodeError) as exc:
                if has_fallback:
                    continue
                raise AppException(
                    status_code=503,
                    message="AI service returned invalid quiz format",
                    detail={"code": "LLM_INVALID_QUIZ_FORMAT", "error": str(exc)},
                ) from exc

            return model_name, questions

    raise AppException(
        status_code=503,
        message="AI service unavailable",
        detail={"code": "LLM_SERVICE_ERROR"},
    )