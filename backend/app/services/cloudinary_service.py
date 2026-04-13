from __future__ import annotations

from dataclasses import dataclass
import hashlib
import logging
from pathlib import Path
import re
import time
from uuid import uuid4

import httpx

from app.core.config import get_settings
from app.core.exceptions import AppException

logger = logging.getLogger("app.cloudinary")


@dataclass(frozen=True)
class CloudinaryUploadResult:
    public_id: str
    secure_url: str
    resource_type: str
    original_filename: str | None
    format: str | None


def _require_cloudinary_config() -> tuple[str, str, str]:
    settings = get_settings()
    cloud_name = (settings.cloudinary_cloud_name or "").strip()
    api_key = (settings.cloudinary_api_key or "").strip()
    api_secret = (settings.cloudinary_api_secret or "").strip()

    if not cloud_name or not api_key or not api_secret:
        raise AppException(
            status_code=503,
            message="Cloudinary is not configured",
            detail={"code": "CLOUDINARY_NOT_CONFIGURED"},
        )

    return cloud_name, api_key, api_secret


def _build_signature(params: dict[str, str], *, api_secret: str) -> str:
    serial = "&".join(f"{key}={params[key]}" for key in sorted(params.keys()) if params[key] != "")
    return hashlib.sha1(f"{serial}{api_secret}".encode("utf-8")).hexdigest()


def _safe_public_id_segment(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
    return (normalized or "document")[:80]


def upload_original_document(
    *,
    user_id: int,
    file_name: str | None,
    content_type: str | None,
    file_bytes: bytes,
) -> CloudinaryUploadResult:
    if not file_bytes:
        raise AppException(
            status_code=400,
            message="Uploaded file is empty",
            detail={"code": "PARSER_FILE_EMPTY"},
        )

    cloud_name, api_key, api_secret = _require_cloudinary_config()
    settings = get_settings()
    folder = (settings.cloudinary_upload_folder or "personal-learning/documents").strip("/")

    original_name = file_name or f"upload-{uuid4().hex}"
    stem = _safe_public_id_segment(Path(original_name).stem)
    public_id = f"user_{user_id}/{stem}-{uuid4().hex[:10]}"

    timestamp = str(int(time.time()))
    sign_params = {
        "folder": folder,
        "public_id": public_id,
        "timestamp": timestamp,
    }
    signature = _build_signature(sign_params, api_secret=api_secret)

    endpoint = f"https://api.cloudinary.com/v1_1/{cloud_name}/auto/upload"
    files = {
        "file": (
            original_name,
            file_bytes,
            (content_type or "application/octet-stream").split(";")[0].strip() or "application/octet-stream",
        )
    }

    try:
        with httpx.Client(timeout=45.0) as client:
            response = client.post(
                endpoint,
                data={
                    **sign_params,
                    "api_key": api_key,
                    "signature": signature,
                },
                files=files,
            )
    except httpx.TimeoutException as exc:
        raise AppException(
            status_code=503,
            message="Cloudinary upload timeout",
            detail={"code": "CLOUDINARY_TIMEOUT"},
        ) from exc
    except httpx.RequestError as exc:
        raise AppException(
            status_code=503,
            message="Cloudinary network error",
            detail={"code": "CLOUDINARY_NETWORK_ERROR"},
        ) from exc

    if response.status_code >= 400:
        message = "Cloudinary upload failed"
        try:
            payload = response.json()
            error_block = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(error_block, dict) and isinstance(error_block.get("message"), str):
                message = error_block["message"]
        except Exception:
            pass

        raise AppException(
            status_code=503,
            message=message,
            detail={"code": "CLOUDINARY_UPLOAD_FAILED"},
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise AppException(
            status_code=503,
            message="Cloudinary returned invalid response",
            detail={"code": "CLOUDINARY_INVALID_RESPONSE"},
        ) from exc

    secure_url = payload.get("secure_url") if isinstance(payload, dict) else None
    if not isinstance(secure_url, str) or not secure_url.strip():
        raise AppException(
            status_code=503,
            message="Cloudinary returned empty secure_url",
            detail={"code": "CLOUDINARY_INVALID_RESPONSE"},
        )

    resource_type = payload.get("resource_type") if isinstance(payload, dict) else None
    if not isinstance(resource_type, str) or not resource_type:
        resource_type = "raw"

    uploaded_public_id = payload.get("public_id") if isinstance(payload, dict) else None
    if not isinstance(uploaded_public_id, str) or not uploaded_public_id:
        uploaded_public_id = public_id

    original_filename = payload.get("original_filename") if isinstance(payload, dict) else None
    if not isinstance(original_filename, str):
        original_filename = None

    file_format = payload.get("format") if isinstance(payload, dict) else None
    if not isinstance(file_format, str):
        file_format = None

    return CloudinaryUploadResult(
        public_id=uploaded_public_id,
        secure_url=secure_url,
        resource_type=resource_type,
        original_filename=original_filename,
        format=file_format,
    )


def delete_original_document(*, public_id: str, resource_type: str = "raw") -> None:
    normalized_public_id = (public_id or "").strip()
    if not normalized_public_id:
        return

    cloud_name, api_key, api_secret = _require_cloudinary_config()

    timestamp = str(int(time.time()))
    sign_params = {
        "public_id": normalized_public_id,
        "timestamp": timestamp,
    }
    signature = _build_signature(sign_params, api_secret=api_secret)

    normalized_resource_type = (resource_type or "raw").strip().lower() or "raw"
    endpoint = f"https://api.cloudinary.com/v1_1/{cloud_name}/{normalized_resource_type}/destroy"

    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.post(
                endpoint,
                data={
                    **sign_params,
                    "api_key": api_key,
                    "signature": signature,
                },
            )
    except Exception as exc:  # pragma: no cover - cleanup best effort
        logger.warning("cloudinary.destroy_request_failed public_id=%s error=%s", normalized_public_id, str(exc))
        return

    if response.status_code >= 400:
        logger.warning(
            "cloudinary.destroy_failed public_id=%s status=%s body=%s",
            normalized_public_id,
            response.status_code,
            (response.text or "")[:300],
        )
