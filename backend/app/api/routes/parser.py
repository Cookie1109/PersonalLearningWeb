from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from pydantic import ValidationError
from starlette.datastructures import UploadFile

from app.api.deps import get_current_user
from app.core.exceptions import AppException
from app.models import User
from app.schemas import ErrorResponseDTO, ParserExtractResponseDTO, ParserExtractUrlRequestDTO
from app.services import parser_service

router = APIRouter(prefix="/parser", tags=["parser"])

ERROR_RESPONSES = {
    400: {"model": ErrorResponseDTO, "description": "Bad Request"},
    401: {"model": ErrorResponseDTO, "description": "Unauthorized"},
    403: {"model": ErrorResponseDTO, "description": "Forbidden"},
    409: {"model": ErrorResponseDTO, "description": "Conflict"},
    413: {"model": ErrorResponseDTO, "description": "Payload Too Large"},
    503: {"model": ErrorResponseDTO, "description": "Service Unavailable"},
}


@router.post(
    "/extract-text",
    response_model=ParserExtractResponseDTO,
    status_code=status.HTTP_200_OK,
    responses=ERROR_RESPONSES,
)
async def extract_text(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> ParserExtractResponseDTO:
    _ = current_user

    content_type = (request.headers.get("content-type") or "").lower()

    if "application/json" in content_type:
        try:
            payload_dict = await request.json()
            payload = ParserExtractUrlRequestDTO.model_validate(payload_dict)
        except ValidationError as exc:
            raise AppException(
                status_code=400,
                message="URL input is invalid",
                detail={"code": "PARSER_URL_REQUIRED", "error": str(exc)},
            ) from exc
        except Exception as exc:
            raise AppException(
                status_code=400,
                message="Invalid JSON payload",
                detail={"code": "PARSER_INVALID_JSON"},
            ) from exc

        extracted_text = parser_service.extract_text_from_url(url=payload.url)
        return ParserExtractResponseDTO(
            extracted_text=extracted_text,
            source_type="url",
            mime_type="text/html",
        )

    if "multipart/form-data" in content_type:
        form = await request.form()

        url_value = form.get("url")
        if isinstance(url_value, str) and url_value.strip():
            extracted_text = parser_service.extract_text_from_url(url=url_value.strip())
            return ParserExtractResponseDTO(
                extracted_text=extracted_text,
                source_type="url",
                mime_type="text/html",
            )

        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise AppException(
                status_code=400,
                message="Parser input is required",
                detail={"code": "PARSER_INPUT_REQUIRED"},
            )

        try:
            file_bytes = await upload.read()
            extracted_text, source_type, mime_type = parser_service.extract_text_from_uploaded_file(
                file_name=upload.filename,
                content_type=upload.content_type,
                file_bytes=file_bytes,
            )
        finally:
            await upload.close()

        return ParserExtractResponseDTO(
            extracted_text=extracted_text,
            source_type=source_type,
            mime_type=mime_type,
        )

    raise AppException(
        status_code=400,
        message="Unsupported content type",
        detail={"code": "PARSER_CONTENT_TYPE_UNSUPPORTED"},
    )
