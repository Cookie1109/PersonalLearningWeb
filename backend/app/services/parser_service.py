from __future__ import annotations

import base64
import io
import logging
import re
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
import requests
from bs4 import BeautifulSoup
from docx import Document as DocxDocument
from PyPDF2 import PdfReader

from app.core.config import get_settings
from app.core.exceptions import AppException

logger = logging.getLogger("app.parser")

ParserSourceType = Literal["url", "pdf", "docx", "image"]

MAX_UPLOAD_FILE_BYTES = 15 * 1024 * 1024
MAX_URL_DOWNLOAD_BYTES = 5 * 1024 * 1024
MAX_EXTRACTED_TEXT_LENGTH = 120000

SUPPORTED_IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}
SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
SUPPORTED_DOCX_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}


def _collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _normalize_extracted_text(value: str) -> str:
    lines = [_collapse_whitespace(line) for line in value.splitlines()]
    normalized = "\n".join([line for line in lines if line]).strip()
    if len(normalized) > MAX_EXTRACTED_TEXT_LENGTH:
        return normalized[:MAX_EXTRACTED_TEXT_LENGTH].strip()
    return normalized


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
    configured_pro_model = (settings.gemini_pro_model or "").strip() or "gemini-2.5-pro"

    candidates: list[str] = []
    for candidate in (
        configured_flash_model,
        _normalize_model_name(configured_flash_model),
        configured_pro_model,
        _normalize_model_name(configured_pro_model),
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


def _validate_url(url: str) -> str:
    normalized_url = url.strip()
    parsed = urlparse(normalized_url)
    if parsed.scheme not in {"http", "https"}:
        raise AppException(
            status_code=400,
            message="URL must start with http or https",
            detail={"code": "PARSER_URL_INVALID"},
        )

    if not parsed.netloc:
        raise AppException(
            status_code=400,
            message="URL is invalid",
            detail={"code": "PARSER_URL_INVALID"},
        )

    return normalized_url


def _extract_text_from_html(html_text: str) -> str:
    soup = BeautifulSoup(html_text, "html.parser")

    for tag in soup(["script", "style", "noscript", "iframe", "svg"]):
        tag.decompose()

    container = soup.find("article") or soup.find("main") or soup.body or soup
    extracted = container.get_text("\n", strip=True)
    normalized = _normalize_extracted_text(extracted)

    if not normalized:
        raise AppException(
            status_code=409,
            message="No readable text found from URL",
            detail={"code": "PARSER_TEXT_EMPTY"},
        )

    return normalized


def extract_text_from_url(*, url: str) -> str:
    normalized_url = _validate_url(url)

    try:
        response = requests.get(
            normalized_url,
            timeout=20,
            headers={
                "User-Agent": "PersonalLearningParser/1.0",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            allow_redirects=True,
        )
        response.raise_for_status()
    except requests.Timeout as exc:
        raise AppException(
            status_code=503,
            message="URL fetch timed out",
            detail={"code": "PARSER_URL_TIMEOUT"},
        ) from exc
    except requests.RequestException as exc:
        raise AppException(
            status_code=503,
            message="Unable to fetch URL",
            detail={"code": "PARSER_URL_FETCH_FAILED"},
        ) from exc

    content = response.content or b""
    if len(content) > MAX_URL_DOWNLOAD_BYTES:
        raise AppException(
            status_code=413,
            message="URL content is too large",
            detail={"code": "PARSER_URL_TOO_LARGE"},
        )

    content_type = (response.headers.get("content-type") or "").lower()
    if "text/html" not in content_type and "application/xhtml+xml" not in content_type and "text/plain" not in content_type:
        raise AppException(
            status_code=400,
            message="URL content type is not supported",
            detail={"code": "PARSER_URL_UNSUPPORTED_CONTENT"},
        )

    try:
        if "text/plain" in content_type:
            text = (response.text or "").strip()
            normalized = _normalize_extracted_text(text)
            if not normalized:
                raise AppException(
                    status_code=409,
                    message="No readable text found from URL",
                    detail={"code": "PARSER_TEXT_EMPTY"},
                )
            return normalized

        return _extract_text_from_html(response.text or "")
    except AppException:
        raise
    except Exception as exc:
        logger.warning("parser.url_extract_failed url=%s error=%s", normalized_url, str(exc))
        raise AppException(
            status_code=503,
            message="Failed to extract text from URL",
            detail={"code": "PARSER_URL_EXTRACT_FAILED"},
        ) from exc


def extract_text_from_pdf_bytes(*, file_bytes: bytes) -> str:
    if not file_bytes:
        raise AppException(
            status_code=400,
            message="Uploaded file is empty",
            detail={"code": "PARSER_FILE_EMPTY"},
        )

    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        chunks: list[str] = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text.strip():
                chunks.append(text)

        normalized = _normalize_extracted_text("\n".join(chunks))
        if not normalized:
            raise AppException(
                status_code=409,
                message="No readable text found in PDF",
                detail={"code": "PARSER_TEXT_EMPTY"},
            )
        return normalized
    except AppException:
        raise
    except Exception as exc:
        raise AppException(
            status_code=409,
            message="Failed to read PDF file",
            detail={"code": "PARSER_PDF_READ_FAILED"},
        ) from exc


def extract_text_from_docx_bytes(*, file_bytes: bytes) -> str:
    if not file_bytes:
        raise AppException(
            status_code=400,
            message="Uploaded file is empty",
            detail={"code": "PARSER_FILE_EMPTY"},
        )

    try:
        document = DocxDocument(io.BytesIO(file_bytes))
        chunks = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
        normalized = _normalize_extracted_text("\n".join(chunks))
        if not normalized:
            raise AppException(
                status_code=409,
                message="No readable text found in DOCX",
                detail={"code": "PARSER_TEXT_EMPTY"},
            )
        return normalized
    except AppException:
        raise
    except Exception as exc:
        raise AppException(
            status_code=409,
            message="Failed to read DOCX file",
            detail={"code": "PARSER_DOCX_READ_FAILED"},
        ) from exc


def extract_text_from_image_bytes_via_gemini(*, file_bytes: bytes, mime_type: str) -> str:
    if not file_bytes:
        raise AppException(
            status_code=400,
            message="Uploaded image is empty",
            detail={"code": "PARSER_FILE_EMPTY"},
        )

    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        raise AppException(
            status_code=503,
            message="AI service is not configured",
            detail={"code": "LLM_API_KEY_MISSING"},
        )

    image_base64 = base64.b64encode(file_bytes).decode("utf-8")
    model_candidates = _build_model_candidates(settings)
    timeout_seconds = max(60.0, float(settings.gemini_timeout_seconds))

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": "Extract and return all readable text from this image accurately. Return only extracted text.",
                    },
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": image_base64,
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 4096,
        },
    }

    with httpx.Client(timeout=timeout_seconds) as client:
        for index, model_name in enumerate(model_candidates):
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            has_fallback = index < len(model_candidates) - 1

            try:
                response = client.post(endpoint, params={"key": api_key}, json=payload)
            except httpx.TimeoutException as exc:
                if has_fallback:
                    continue
                raise AppException(status_code=503, message="AI service timeout", detail={"code": "LLM_TIMEOUT"}) from exc
            except httpx.RequestError as exc:
                if has_fallback:
                    continue
                raise AppException(
                    status_code=503,
                    message="AI service network error",
                    detail={"code": "LLM_NETWORK_ERROR"},
                ) from exc

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
                    detail={"code": "LLM_SERVICE_ERROR"},
                )

            try:
                response_payload = response.json()
            except ValueError as exc:
                if has_fallback:
                    continue
                raise AppException(
                    status_code=503,
                    message="AI service returned invalid response",
                    detail={"code": "LLM_INVALID_RESPONSE"},
                ) from exc

            extracted_text = _normalize_extracted_text(_extract_gemini_text(response_payload))
            if extracted_text:
                return extracted_text

            if has_fallback:
                continue
            raise AppException(
                status_code=409,
                message="No readable text found in image",
                detail={"code": "PARSER_TEXT_EMPTY"},
            )

    raise AppException(
        status_code=503,
        message="AI service unavailable",
        detail={"code": "LLM_SERVICE_ERROR"},
    )


def _detect_uploaded_source_type(*, file_name: str | None, content_type: str | None) -> ParserSourceType:
    suffix = Path(file_name or "").suffix.lower()
    normalized_content_type = (content_type or "").split(";")[0].strip().lower()

    if normalized_content_type == "application/pdf" or suffix == ".pdf":
        return "pdf"

    if normalized_content_type in SUPPORTED_DOCX_MIME_TYPES or suffix == ".docx":
        return "docx"

    if normalized_content_type in SUPPORTED_IMAGE_MIME_TYPES or suffix in SUPPORTED_IMAGE_EXTENSIONS:
        return "image"

    raise AppException(
        status_code=400,
        message="Unsupported file format",
        detail={"code": "PARSER_UNSUPPORTED_FORMAT"},
    )


def extract_text_from_uploaded_file(
    *,
    file_name: str | None,
    content_type: str | None,
    file_bytes: bytes,
) -> tuple[str, ParserSourceType, str | None]:
    if not file_bytes:
        raise AppException(
            status_code=400,
            message="Uploaded file is empty",
            detail={"code": "PARSER_FILE_EMPTY"},
        )

    if len(file_bytes) > MAX_UPLOAD_FILE_BYTES:
        raise AppException(
            status_code=413,
            message="Uploaded file is too large",
            detail={"code": "PARSER_FILE_TOO_LARGE"},
        )

    source_type = _detect_uploaded_source_type(file_name=file_name, content_type=content_type)
    normalized_content_type = (content_type or "").split(";")[0].strip().lower() or None

    if source_type == "pdf":
        return extract_text_from_pdf_bytes(file_bytes=file_bytes), "pdf", normalized_content_type

    if source_type == "docx":
        return extract_text_from_docx_bytes(file_bytes=file_bytes), "docx", normalized_content_type

    mime_type = normalized_content_type if normalized_content_type in SUPPORTED_IMAGE_MIME_TYPES else "image/jpeg"
    return extract_text_from_image_bytes_via_gemini(file_bytes=file_bytes, mime_type=mime_type), "image", mime_type
