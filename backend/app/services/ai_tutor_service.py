from __future__ import annotations

import html
import logging
import re
from typing import Any, AsyncGenerator

import google.generativeai as genai

from app.core.config import get_settings

logger = logging.getLogger("app.ai_tutor")

SYSTEM_PROMPT_TEMPLATE = (
    "Bạn là NEXL Tutor - một gia sư AI tận tâm, chuyên hướng dẫn người dùng dựa trên tài liệu học tập được cung cấp.\n\n"
    "Luật chơi của bạn:\n"
    "1. Ưu tiên tuyệt đối: Trả lời mọi câu hỏi dựa CHÍNH XÁC vào nội dung của [TÀI_LIỆU_TRÍCH_XUẤT] được cung cấp dưới đây.\n"
    "2. Quyền mở rộng an toàn: Nếu câu hỏi của người dùng vượt ra ngoài [TÀI_LIỆU_TRÍCH_XUẤT] nhưng VẪN LIÊN QUAN TRỰC TIẾP đến chủ đề cốt lõi của tài liệu (ví dụ: tài liệu dạy tạo bảng PostgreSQL, người dùng hỏi cách chèn dữ liệu giả), bạn được phép sử dụng kiến thức bên ngoài để hướng dẫn thêm.\n"
    "3. Vạch ranh giới rõ ràng: Nếu câu hỏi HOÀN TOÀN KHÔNG LIÊN QUAN đến chủ đề bài học, bạn PHẢI TỪ CHỐI trả lời một cách lịch sự và hướng người dùng quay lại nội dung bài học.\n"
    "4. Minh bạch: Khi sử dụng kiến thức bên ngoài (không có trong tài liệu), hãy bắt đầu bằng câu: \"Mặc dù tài liệu hiện tại không đề cập chi tiết, nhưng trong thực tế...\"\n\n"
    "[TÀI_LIỆU_TRÍCH_XUẤT]\n"
    "{source_content}\n\n"
    "[CÂU_HỎI_CỦA_NGƯỜI_DÙNG]\n"
    "{question}"
)

TUTOR_SOURCE_MAX_CHARS = 15000
TUTOR_SOURCE_MAX_WORDS = 3000
TUTOR_MAX_OUTPUT_TOKENS = 2048
TUTOR_SAFETY_SETTINGS = [
    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
]


def _normalize_model_name(raw_model: str) -> str:
    model = (raw_model or "").strip()
    if model.startswith("models/"):
        model = model.split("/", 1)[1]

    legacy_map = {
        "gemini-1.5-flash": "gemini-2.5-flash",
        "gemini-1.5-pro": "gemini-2.5-pro",
    }
    return legacy_map.get(model, model)


def _sanitize_source_content(raw_text: str) -> str:
    if not raw_text:
        return ""
    decoded = html.unescape(raw_text)
    without_html = re.sub(r"<[^>]+>", " ", decoded)
    cleaned = without_html.replace("\u00a0", " ")
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", " ", cleaned)
    cleaned = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", cleaned)
    return " ".join(cleaned.split())


def _truncate_source_content(clean_text: str) -> str:
    if not clean_text:
        return ""
    truncated = clean_text
    was_truncated = False

    words = truncated.split()
    if len(words) > TUTOR_SOURCE_MAX_WORDS:
        truncated = " ".join(words[:TUTOR_SOURCE_MAX_WORDS])
        was_truncated = True

    if len(truncated) > TUTOR_SOURCE_MAX_CHARS:
        truncated = truncated[:TUTOR_SOURCE_MAX_CHARS].rstrip()
        was_truncated = True

    if was_truncated:
        truncated = f"{truncated.rstrip()} ..."

    return truncated


def _build_system_prompt(*, source_content: str, question: str) -> str:
    sanitized_source = _sanitize_source_content(source_content or "")
    bounded_source = _truncate_source_content(sanitized_source)
    return SYSTEM_PROMPT_TEMPLATE.format(
        source_content=bounded_source,
        question=(question or "").strip(),
    )


def _format_sse(text: str) -> bytes:
    if not text:
        return b""
    lines = text.replace("\r", "").split("\n")
    data = "".join(f"data: {line}\n" for line in lines)
    return f"{data}\n".encode("utf-8")


async def stream_tutor_answer(*, source_content: str, question: str) -> AsyncGenerator[bytes, None]:
    normalized_source = (source_content or "").strip()
    if not normalized_source:
        yield _format_sse("[LỖI HỆ THỐNG]: Document source content is empty")
        return

    normalized_question = (question or "").strip()
    if not normalized_question:
        yield _format_sse("[LỖI HỆ THỐNG]: Question is required")
        return

    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        yield _format_sse("[LỖI HỆ THỐNG]: AI service is not configured")
        return

    configured_model = settings.gemini_model.strip() or "gemini-2.5-flash"
    model_name = _normalize_model_name(configured_model)
    if model_name != configured_model:
        logger.warning("tutor.remap_legacy_model from=%s to=%s", configured_model, model_name)

    system_prompt = _build_system_prompt(source_content=normalized_source, question=normalized_question)
    prompt_length = len(system_prompt)
    prompt_head = system_prompt[:500]
    prompt_tail = system_prompt[-200:] if prompt_length > 200 else system_prompt
    logger.info("tutor.prompt_length=%s", prompt_length)
    logger.info("tutor.prompt_head=%s", prompt_head)
    logger.info("tutor.prompt_tail=%s", prompt_tail)
    yielded_any = False
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name,
            generation_config={
                "temperature": 0.3,
                "max_output_tokens": TUTOR_MAX_OUTPUT_TOKENS,
            },
            safety_settings=TUTOR_SAFETY_SETTINGS,
        )

        response = model.generate_content(system_prompt, stream=True)
        for chunk in response:
            chunk_text = getattr(chunk, "text", "")
            if chunk_text:
                logger.info("tutor.chunk_text=%s", chunk_text)
                yielded_any = True
                yield _format_sse(chunk_text)

        if not yielded_any:
            yield _format_sse("[LỖI HỆ THỐNG]: AI service returned empty stream")
    except Exception as exc:  # pragma: no cover - defensive catch
        logger.exception("tutor.stream_failed error=%s", str(exc))
        yield _format_sse(f"[LỖI HỆ THỐNG]: {str(exc)}")
