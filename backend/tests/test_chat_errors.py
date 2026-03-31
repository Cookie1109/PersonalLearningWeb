from __future__ import annotations

from types import SimpleNamespace

import httpx


class FakeResponse:
    def __init__(self, *, status_code: int, payload: dict | None = None, json_error: Exception | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self._json_error = json_error

    def json(self) -> dict:
        if self._json_error:
            raise self._json_error
        return self._payload


def _patch_chat_settings(monkeypatch) -> None:
    import app.services.chat_service as chat_service

    monkeypatch.setattr(
        chat_service,
        "get_settings",
        lambda: SimpleNamespace(
            gemini_api_key="test-key",
            gemini_model="gemini-1.5-flash",
            gemini_timeout_seconds=5.0,
        ),
    )


def _patch_http_client(monkeypatch, *, response: FakeResponse | None = None, error: Exception | None = None) -> None:
    import app.services.chat_service as chat_service

    class FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            _ = (args, kwargs)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            _ = (exc_type, exc, tb)
            return False

        def post(self, *args, **kwargs):
            _ = (args, kwargs)
            if error is not None:
                raise error
            return response

    monkeypatch.setattr(chat_service.httpx, "Client", FakeClient)


def test_chat_returns_controlled_error_when_provider_401(
    client,
    auth_headers,
    monkeypatch,
) -> None:
    _user, headers = auth_headers

    _patch_chat_settings(monkeypatch)
    _patch_http_client(
        monkeypatch,
        response=FakeResponse(
            status_code=401,
            payload={"error": {"message": "API key invalid"}},
        ),
    )

    response = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "Xin tu van lo trinh hoc Go"}]},
        headers=headers,
    )

    assert response.status_code in (401, 503)
    assert response.status_code != 500


def test_chat_returns_controlled_error_when_provider_timeout(
    client,
    auth_headers,
    monkeypatch,
) -> None:
    _user, headers = auth_headers

    _patch_chat_settings(monkeypatch)
    _patch_http_client(
        monkeypatch,
        error=httpx.TimeoutException("provider timeout"),
    )

    response = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "Hoc he thong phan tan"}]},
        headers=headers,
    )

    assert response.status_code in (401, 503)
    assert response.status_code != 500


def test_chat_returns_controlled_error_when_provider_returns_error_json(
    client,
    auth_headers,
    monkeypatch,
) -> None:
    _user, headers = auth_headers

    _patch_chat_settings(monkeypatch)
    _patch_http_client(
        monkeypatch,
        response=FakeResponse(
            status_code=200,
            payload={"error": {"message": "provider internal error"}},
        ),
    )

    response = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "Toi muon hoc Rust"}]},
        headers=headers,
    )

    assert response.status_code in (401, 503)
    assert response.status_code != 500
