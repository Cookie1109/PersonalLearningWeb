from __future__ import annotations

import logging
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.models import ChatMessage

logger = logging.getLogger("app.chat")


def _normalize_model_name(raw_model: str) -> str:
    model = (raw_model or "").strip()
    if model.startswith("models/"):
        model = model.split("/", 1)[1]

    legacy_map = {
        "gemini-1.5-flash": "gemini-2.5-flash",
        "gemini-1.5-pro": "gemini-2.5-pro",
    }
    return legacy_map.get(model, model)

SYSTEM_PROMPT = (
    "Ban la mot Chuyen gia Dao tao Da linh vuc (Polymath) hang dau the gioi. "
    "Ban co kha nang thiet ke lo trinh va giang day BAT KY chu de nao. "
    "TUYET DOI KHONG su dung cac thuat ngu IT/Lap trinh (nhu moi truong code, bien, cu phap...) "
    "neu chu de nguoi dung yeu cau khong lien quan den cong nghe. "
    "Tra loi ro rang, co cau truc, va LUON ket thuc bang cau tron ven (khong bo do giua chung). "
    "Neu nguoi dung yeu cau so sanh hoac tu van lua chon, dua ra khuyen nghi cu the va ly do ngan gon. "
    "If the user expresses intent to learn a new topic, append this exact tag format on a NEW final line only after a complete answer: "
    "[SUGGEST_ROADMAP: Topic Name]. Never cut the sentence right before this tag."
)


def _last_user_message(messages: list[dict[str, str]]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            return message.get("content", "").strip()
    return ""


def _to_gemini_contents(messages: list[dict[str, str]]) -> list[dict[str, Any]]:
    contents: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role")
        text = message.get("content", "").strip()
        if role not in ("user", "assistant") or not text:
            continue

        contents.append(
            {
                "role": "model" if role == "assistant" else "user",
                "parts": [{"text": text}],
            }
        )

    return contents


def _extract_reply_from_gemini(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""

    first_candidate = candidates[0]
    if not isinstance(first_candidate, dict):
        return ""

    content = first_candidate.get("content")
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


def generate_chat_reply(*, messages: list[dict[str, str]], system_prompt: str = SYSTEM_PROMPT) -> str:
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        raise AppException(
            status_code=503,
            message="AI service is not configured",
            detail={"code": "LLM_API_KEY_MISSING"},
        )

    contents = _to_gemini_contents(messages)
    if not contents or contents[-1].get("role") != "user":
        raise AppException(
            status_code=400,
            message="At least one user message is required",
            detail={"code": "CHAT_MESSAGE_REQUIRED"},
        )

    configured_model = settings.gemini_model.strip() or "gemini-2.5-flash"
    model_name = _normalize_model_name(configured_model)
    if model_name != configured_model:
        logger.warning("chat.remap_legacy_model from=%s to=%s", configured_model, model_name)
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"

    request_payload = {
        "systemInstruction": {
            "role": "user",
            "parts": [{"text": system_prompt}],
        },
        "contents": contents,
        "generationConfig": {
            "temperature": 0.5,
            "maxOutputTokens": 2048,
        },
    }

    try:
        with httpx.Client(timeout=settings.gemini_timeout_seconds) as client:
            response = client.post(endpoint, params={"key": api_key}, json=request_payload)
    except httpx.TimeoutException as exc:
        raise AppException(
            status_code=503,
            message="AI service timeout",
            detail={"code": "LLM_TIMEOUT"},
        ) from exc
    except httpx.RequestError as exc:
        raise AppException(
            status_code=503,
            message="AI service network error",
            detail={"code": "LLM_NETWORK_ERROR"},
        ) from exc

    if response.status_code in (401, 403):
        logger.warning("chat.llm_auth_failed", extra={"status_code": response.status_code})
        raise AppException(
            status_code=503,
            message="AI service authentication failed",
            detail={"code": "LLM_AUTH_FAILED"},
        )

    if response.status_code >= 400:
        logger.warning("chat.llm_error", extra={"status_code": response.status_code})
        raise AppException(
            status_code=503,
            message="AI service unavailable",
            detail={"code": "LLM_SERVICE_ERROR"},
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise AppException(
            status_code=503,
            message="AI service returned invalid response",
            detail={"code": "LLM_INVALID_RESPONSE"},
        ) from exc

    reply = _extract_reply_from_gemini(payload)
    if not reply:
        raise AppException(
            status_code=503,
            message="AI service returned empty response",
            detail={"code": "LLM_EMPTY_RESPONSE"},
        )

    return reply


def get_chat_history(*, db: Session, user_id: int, limit: int = 200) -> list[ChatMessage]:
    messages = list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.user_id == user_id)
            .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
            .limit(limit)
        )
    )
    messages.reverse()
    return messages


def process_chat_turn(*, db: Session, user_id: int, messages: list[dict[str, str]]) -> str:
    user_prompt = _last_user_message(messages)
    if not user_prompt:
        raise AppException(
            status_code=400,
            message="At least one user message is required",
            detail={"code": "CHAT_MESSAGE_REQUIRED"},
        )

    persisted_messages = get_chat_history(db=db, user_id=user_id, limit=40)
    conversation = [{"role": msg.role, "content": msg.content} for msg in persisted_messages]
    conversation.append({"role": "user", "content": user_prompt})

    reply = generate_chat_reply(messages=conversation)

    try:
        db.add(ChatMessage(user_id=user_id, role="user", content=user_prompt))
        db.add(ChatMessage(user_id=user_id, role="assistant", content=reply))
        db.commit()
    except Exception as exc:
        db.rollback()
        raise AppException(
            status_code=409,
            message="Failed to persist chat messages",
            detail={"code": "CHAT_PERSIST_FAILED"},
        ) from exc

    return reply

