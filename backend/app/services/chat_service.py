from __future__ import annotations

import logging
import re
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.models import ChatMessage

logger = logging.getLogger("app.chat")
INCOMPLETE_TRAILING_PATTERN = re.compile(r"[:\-\(\[/,;]$")


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
DOCUMENT_CHAT_HISTORY_MAX_MESSAGES = 20
DOCUMENT_CHAT_HISTORY_MAX_CHARS = 18000
DOCUMENT_CHAT_SOURCE_MAX_CHARS = 45000


def _last_user_message(messages: list[dict[str, str]]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            return message.get("content", "").strip()
    return ""


def _normalize_document_chat_history(history: list[dict[str, str]]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for item in history:
        role = item.get("role")
        content = (item.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        normalized.append({"role": role, "content": content})
    return normalized


def _truncate_document_chat_history(history: list[dict[str, str]]) -> list[dict[str, str]]:
    if not history:
        return []

    tail = history[-DOCUMENT_CHAT_HISTORY_MAX_MESSAGES :]
    kept: list[dict[str, str]] = []
    total_chars = 0
    for item in reversed(tail):
        item_len = len(item["content"])
        if kept and total_chars + item_len > DOCUMENT_CHAT_HISTORY_MAX_CHARS:
            break
        kept.append(item)
        total_chars += item_len

    kept.reverse()
    return kept


def build_document_chat_system_prompt(*, source_content: str) -> str:
    bounded_source = (source_content or "").strip()[:DOCUMENT_CHAT_SOURCE_MAX_CHARS]
    return (
        "Ban la gia su AI cho che do NotebookLM Mini. "
        "Nhiem vu cua ban la tra loi cau hoi CHI dua tren tai lieu nguon duoc cung cap ben duoi. "
        "Tai lieu nguon la su that DUY NHAT. TUYET DOI KHONG bo sung kien thuc ben ngoai tai lieu, KHONG suy doan. "
        "Neu nguoi dung hoi ngoai pham vi tai lieu, khong duoc tu dien giai them. "
        "Neu tai lieu khong co thong tin de tra loi, phai noi dung nguyen van: 'Tai lieu khong de cap den van de nay'. "
        "Tra loi ngan gon, ro rang, uu tien giai thich theo bullet neu can. "
        "Neu tai lieu co code, command hoac bang bieu thi trinh bay bang Markdown GFM tuong ung.\n\n"
        "Tai lieu nguon:\n"
        f"{bounded_source}"
    )


def generate_document_chat_reply(*, source_content: str, message: str, history: list[dict[str, str]] | None = None) -> str:
    source = (source_content or "").strip()
    if not source:
        raise AppException(
            status_code=409,
            message="Document source content is empty",
            detail={"code": "LESSON_SOURCE_EMPTY"},
        )

    user_message = (message or "").strip()
    if not user_message:
        raise AppException(
            status_code=400,
            message="Question message is required",
            detail={"code": "CHAT_MESSAGE_REQUIRED"},
        )

    normalized_history = _normalize_document_chat_history(history or [])
    bounded_history = _truncate_document_chat_history(normalized_history)
    conversation = [*bounded_history, {"role": "user", "content": user_message}]

    return generate_chat_reply(
        messages=conversation,
        system_prompt=build_document_chat_system_prompt(source_content=source),
    )


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


def _extract_finish_reason(payload: dict[str, Any]) -> str | None:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return None

    first_candidate = candidates[0]
    if not isinstance(first_candidate, dict):
        return None

    reason = first_candidate.get("finishReason")
    return reason if isinstance(reason, str) else None


def _is_reply_truncated(reply: str, *, finish_reason: str | None) -> bool:
    content = (reply or "").strip()
    if not content:
        return True

    if finish_reason == "MAX_TOKENS":
        return True

    lines = [line.rstrip() for line in content.splitlines() if line.strip()]
    if not lines:
        return True

    last_line = lines[-1]
    if INCOMPLETE_TRAILING_PATTERN.search(last_line):
        return True
    if re.match(r"^#{1,6}\s*$", last_line):
        return True
    if re.match(r"^\*\*[^*]*$", last_line):
        return True

    return False


def _build_continuation_prompt(*, partial_reply: str) -> str:
    return (
        "Cau tra loi ban vua gui dang bi cat giua chung. "
        "Hay viet tiep phan con lai that tron ven, KHONG lap lai noi dung da viet, "
        "giu dung ngu canh va ket thuc bang cau day du.\n\n"
        "[Noi dung da tra loi]\n"
        f"{partial_reply[-6000:]}"
    )


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
            "maxOutputTokens": 3072,
        },
    }

    try:
        with httpx.Client(timeout=settings.gemini_timeout_seconds) as client:
            response = client.post(endpoint, params={"key": api_key}, json=request_payload)
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

            finish_reason = _extract_finish_reason(payload)
            if not _is_reply_truncated(reply, finish_reason=finish_reason):
                return reply

            logger.warning("chat.llm_detected_truncation finish_reason=%s", finish_reason)
            continuation_payload = {
                "systemInstruction": {
                    "role": "user",
                    "parts": [{"text": system_prompt}],
                },
                "contents": [
                    *contents,
                    {"role": "model", "parts": [{"text": reply}]},
                    {"role": "user", "parts": [{"text": _build_continuation_prompt(partial_reply=reply)}]},
                ],
                "generationConfig": {
                    "temperature": 0.45,
                    "maxOutputTokens": 2048,
                },
            }

            try:
                continuation_response = client.post(endpoint, params={"key": api_key}, json=continuation_payload)
                if continuation_response.status_code < 400:
                    continuation_json = continuation_response.json()
                    continuation_text = _extract_reply_from_gemini(continuation_json)
                    if continuation_text:
                        return f"{reply.rstrip()}\n\n{continuation_text.lstrip()}"
            except Exception as continuation_exc:
                logger.warning("chat.llm_continuation_failed error=%s", str(continuation_exc))

            return reply
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

