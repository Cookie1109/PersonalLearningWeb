from __future__ import annotations


def test_extract_text_from_url_json_success(client, auth_headers, monkeypatch) -> None:
    _, headers = auth_headers

    import app.services.parser_service as parser_service

    monkeypatch.setattr(
        parser_service,
        "extract_text_from_url",
        lambda *, url: (f"Extracted from {url}", "Example title"),
    )

    response = client.post(
        "/api/parser/extract-text",
        json={"url": "https://example.com/article"},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source_type"] == "url"
    assert payload["extracted_text"] == "Extracted from https://example.com/article"
    assert payload["extracted_title"] == "Example title"


def test_extract_text_from_file_success(client, auth_headers, monkeypatch) -> None:
    _, headers = auth_headers

    import app.services.parser_service as parser_service

    monkeypatch.setattr(
        parser_service,
        "extract_text_from_uploaded_file",
        lambda *, file_name, content_type, file_bytes: ("Parsed PDF content", "pdf", "application/pdf", "sample"),
    )

    response = client.post(
        "/api/parser/extract-text",
        files={"file": ("sample.pdf", b"%PDF-1.4 fake", "application/pdf")},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source_type"] == "pdf"
    assert payload["mime_type"] == "application/pdf"
    assert payload["extracted_text"] == "Parsed PDF content"
    assert payload["extracted_title"] == "sample"


def test_extract_text_requires_url_when_json(client, auth_headers) -> None:
    _, headers = auth_headers

    response = client.post(
        "/api/parser/extract-text",
        json={},
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "PARSER_URL_REQUIRED"


def test_extract_text_rejects_unsupported_file_format(client, auth_headers) -> None:
    _, headers = auth_headers

    response = client.post(
        "/api/parser/extract-text",
        files={"file": ("notes.txt", b"plain text", "text/plain")},
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "PARSER_UNSUPPORTED_FORMAT"
