from __future__ import annotations

import pytest

import app.services.lesson_service as lesson_service


def _candidate_payload(text: str, finish_reason: str = "STOP") -> dict[str, object]:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": text,
                        }
                    ]
                },
                "finishReason": finish_reason,
            }
        ]
    }


def test_generate_grounded_markdown_continues_when_max_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_payloads: list[dict[str, object]] = []

    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_pro_model = "gemini-1.5-pro"

    class FakeResponse:
        def __init__(self, payload: dict[str, object], status_code: int = 200):
            self._payload = payload
            self.status_code = status_code
            self.text = ""

        def json(self) -> dict[str, object]:
            return self._payload

    responses = [
        FakeResponse(_candidate_payload("## Event Loop\n\nExpress su dung", "MAX_TOKENS")),
        FakeResponse(_candidate_payload("event loop de xu ly request bat dong bo.", "STOP")),
    ]

    class FakeClient:
        def __init__(self, timeout: float):
            _ = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

        def post(self, endpoint: str, *, params: dict[str, str], json: dict[str, object]):
            _ = (endpoint, params)
            captured_payloads.append(json)
            return responses.pop(0)

    monkeypatch.setattr(lesson_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(lesson_service.httpx, "Client", FakeClient)

    output = lesson_service.generate_grounded_markdown(prompt="PROMPT_THEORY")

    assert "Express su dung" in output
    assert "event loop de xu ly request bat dong bo." in output
    assert len(captured_payloads) == 2
    continuation_payload = captured_payloads[1]
    assert continuation_payload["contents"][1]["role"] == "model"


def test_generate_grounded_markdown_returns_single_response_when_not_truncated(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_payloads: list[dict[str, object]] = []

    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_pro_model = "gemini-1.5-pro"

    class FakeResponse:
        status_code = 200
        text = ""

        @staticmethod
        def json() -> dict[str, object]:
            return _candidate_payload("## Noi dung day du\n\nKet thuc hoan chinh.", "STOP")

    class FakeClient:
        def __init__(self, timeout: float):
            _ = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

        def post(self, endpoint: str, *, params: dict[str, str], json: dict[str, object]):
            _ = (endpoint, params)
            captured_payloads.append(json)
            return FakeResponse()

    monkeypatch.setattr(lesson_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(lesson_service.httpx, "Client", FakeClient)

    output = lesson_service.generate_grounded_markdown(prompt="PROMPT_THEORY")

    assert output == "## Noi dung day du\n\nKet thuc hoan chinh."
    assert len(captured_payloads) == 1
