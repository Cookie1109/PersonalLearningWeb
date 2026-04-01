from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.core.security import create_access_token
from app.models import Lesson, Roadmap


def _seed_lesson(db_session: Session, *, user_id: int, title: str = "Lesson Intro") -> Lesson:
    roadmap = Roadmap(
        user_id=user_id,
        goal="Master Python",
        title="Python Roadmap",
        is_active=True,
    )
    db_session.add(roadmap)
    db_session.commit()
    db_session.refresh(roadmap)

    lesson = Lesson(
        roadmap_id=roadmap.id,
        week_number=1,
        position=1,
        title=title,
        content_markdown=None,
        is_completed=False,
    )
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)
    return lesson


def test_get_lesson_detail_requires_ownership(
    client,
    db_session: Session,
    create_user,
) -> None:
    owner, _ = create_user(email="lesson-owner@example.com")
    outsider, _ = create_user(email="lesson-outsider@example.com")

    lesson = _seed_lesson(db_session, user_id=owner.id)

    owner_token, _ = create_access_token(user_id=owner.id, email=owner.email)
    owner_response = client.get(
        f"/api/lessons/{lesson.id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    assert owner_response.status_code == 200
    owner_payload = owner_response.json()
    assert owner_payload["id"] == lesson.id
    assert owner_payload["is_draft"] is True
    assert owner_payload["content_markdown"] is None
    assert owner_payload["youtube_video_id"] is None

    outsider_token, _ = create_access_token(user_id=outsider.id, email=outsider.email)
    outsider_response = client.get(
        f"/api/lessons/{lesson.id}",
        headers={"Authorization": f"Bearer {outsider_token}"},
    )

    assert outsider_response.status_code == 404
    assert outsider_response.json()["detail"]["code"] == "LESSON_NOT_FOUND"


def test_generate_lesson_persists_markdown(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Control Flow")
    generated_markdown = "## Control Flow\n\n- if\n- for\n"
    generated_output = (
        "```json\n"
        "{\n"
        "  \"content_markdown\": \"## Control Flow\\n\\n- if\\n- for\\n\",\n"
        "  \"youtube_search_query\": \"control flow python tutorial tieng viet\"\n"
        "}\n"
        "```"
    )
    captured_query: dict[str, str] = {}

    import app.services.lesson_service as lesson_service

    monkeypatch.setattr(
        lesson_service,
        "generate_lesson_markdown",
        lambda prompt: generated_output,
    )

    def _fake_fetch_youtube_video_id(*, query: str) -> str | None:
        captured_query["value"] = query
        return "dQw4w9WgXcQ"

    monkeypatch.setattr(
        lesson_service,
        "fetch_youtube_video_id",
        _fake_fetch_youtube_video_id,
    )

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["lesson"]["id"] == lesson.id
    assert payload["lesson"]["is_draft"] is False
    assert payload["lesson"]["content_markdown"] == generated_markdown.strip()
    assert payload["lesson"]["youtube_video_id"] == "dQw4w9WgXcQ"
    assert captured_query["value"] == "lap trinh control flow python tutorial tieng viet"

    db_session.refresh(lesson)
    assert lesson.content_markdown == generated_markdown.strip()
    assert lesson.youtube_video_id == "dQw4w9WgXcQ"
    assert lesson.version == 2


def test_generate_lesson_fallbacks_to_legacy_query_when_llm_output_invalid_json(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Relational Data")
    generated_output = "## Relational Data\n\n- Bang du lieu\n- Khoa chinh"
    captured_query: dict[str, str] = {}

    import app.services.lesson_service as lesson_service

    monkeypatch.setattr(
        lesson_service,
        "generate_lesson_markdown",
        lambda prompt: generated_output,
    )

    def _fake_fetch_youtube_video_id(*, query: str) -> str | None:
        captured_query["value"] = query
        return "dQw4w9WgXcQ"

    monkeypatch.setattr(
        lesson_service,
        "fetch_youtube_video_id",
        _fake_fetch_youtube_video_id,
    )

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["lesson"]["id"] == lesson.id
    assert payload["lesson"]["content_markdown"] == generated_output
    assert payload["lesson"]["youtube_video_id"] == "dQw4w9WgXcQ"
    assert captured_query["value"] == "lap trinh Relational Data python"

    db_session.refresh(lesson)
    assert lesson.content_markdown == generated_output
    assert lesson.youtube_video_id == "dQw4w9WgXcQ"


def test_generate_lesson_enforces_csharp_context_in_youtube_query(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers

    roadmap = Roadmap(
        user_id=user.id,
        goal="Toi muon hoc C#",
        title="Lo trinh C#",
        is_active=True,
    )
    db_session.add(roadmap)
    db_session.commit()
    db_session.refresh(roadmap)

    lesson = Lesson(
        roadmap_id=roadmap.id,
        week_number=4,
        position=1,
        title="Lap trinh bat dong bo",
        content_markdown=None,
        is_completed=False,
    )
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)

    captured_query: dict[str, str] = {}

    import app.services.lesson_service as lesson_service

    monkeypatch.setattr(
        lesson_service,
        "generate_lesson_markdown",
        lambda prompt: (
            '{"content_markdown":"## Bai hoc\n\nNoi dung", '
            '"youtube_search_query":"lap trinh bat dong bo"}'
        ),
    )

    def _fake_fetch_youtube_video_id(*, query: str) -> str | None:
        captured_query["value"] = query
        return "dQw4w9WgXcQ"

    monkeypatch.setattr(lesson_service, "fetch_youtube_video_id", _fake_fetch_youtube_video_id)

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 200

    assert "c#" in captured_query["value"].lower()
    assert "lap trinh" in captured_query["value"].lower()


def test_build_lesson_generation_prompt_injects_roadmap_goal() -> None:
    import app.services.lesson_service as lesson_service

    lesson = Lesson(
        roadmap_id=1,
        week_number=2,
        position=1,
        title="Thuc hien cac phep toan",
        content_markdown=None,
        is_completed=False,
    )
    roadmap = Roadmap(
        user_id=1,
        goal="Toi muon hoc C#",
        title="Lo trinh C#",
        is_active=True,
    )

    prompt = lesson_service.build_lesson_generation_prompt(lesson=lesson, roadmap=roadmap)

    assert "ROADMAP GOAL BAT BUOC: 'Toi muon hoc C#'." in prompt
    assert "Bai hoc nay thuoc Tuan 2 cua Khoa hoc 'Lo trinh C#'." in prompt


def test_generate_lesson_still_parses_json_when_roadmap_context_missing(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Food Safety Basics")
    captured_prompt: dict[str, str] = {}
    captured_query: dict[str, str] = {}

    import app.services.lesson_service as lesson_service

    original_get_lesson_for_generation = lesson_service.get_lesson_for_generation

    def _fake_get_lesson_for_generation(*, db: Session, user_id: int, lesson_id: int):
        selected_lesson, _ = original_get_lesson_for_generation(db=db, user_id=user_id, lesson_id=lesson_id)
        return selected_lesson, None

    def _fake_generate_lesson_markdown(prompt: str) -> str:
        captured_prompt["value"] = prompt
        return (
            '{"content_markdown":"## Food Safety\\n\\n- Keep clean", '
            '"youtube_search_query":"food safety basics"}'
        )

    def _fake_fetch_youtube_video_id(*, query: str) -> str | None:
        captured_query["value"] = query
        return "dQw4w9WgXcQ"

    monkeypatch.setattr(lesson_service, "get_lesson_for_generation", _fake_get_lesson_for_generation)
    monkeypatch.setattr(lesson_service, "generate_lesson_markdown", _fake_generate_lesson_markdown)
    monkeypatch.setattr(lesson_service, "fetch_youtube_video_id", _fake_fetch_youtube_video_id)

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["lesson"]["id"] == lesson.id
    assert payload["lesson"]["content_markdown"] == "## Food Safety\n\n- Keep clean"
    assert payload["lesson"]["youtube_video_id"] == "dQw4w9WgXcQ"
    assert payload["lesson"]["roadmap_id"] == lesson.roadmap_id
    assert payload["lesson"]["roadmap_title"] == "Bai hoc tu do"
    assert "Khong tim thay roadmap goal cho bai hoc nay." in captured_prompt["value"]
    assert captured_query["value"] == "food safety basics"


def test_fetch_youtube_video_id_uses_medium_duration_filter(monkeypatch) -> None:
    import app.services.lesson_service as lesson_service

    captured_params: dict[str, str] = {}

    monkeypatch.setattr(
        lesson_service,
        "get_settings",
        lambda: type("_Settings", (), {"youtube_api_key": "fake-key"})(),
    )

    class FakeResponse:
        status_code = 200

        def json(self) -> dict:
            return {
                "items": [
                    {
                        "id": {
                            "videoId": "dQw4w9WgXcQ",
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            _ = (args, kwargs)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            _ = (exc_type, exc, tb)
            return False

        def get(self, url: str, params: dict[str, str]):
            _ = url
            captured_params.update(params)
            return FakeResponse()

    monkeypatch.setattr(lesson_service.httpx, "Client", FakeClient)

    video_id = lesson_service.fetch_youtube_video_id(query="lap trinh C# bat dong bo")
    assert video_id == "dQw4w9WgXcQ"
    assert captured_params["type"] == "video"
    assert captured_params["relevanceLanguage"] == "vi"
    assert captured_params["videoDuration"] == "medium"


def test_generate_lesson_returns_controlled_error_when_llm_fails(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Error Handling")

    import app.services.lesson_service as lesson_service

    def _raise_llm_failure(*, prompt: str) -> str:
        _ = prompt
        raise AppException(
            status_code=503,
            message="AI service timeout",
            detail={"code": "LLM_TIMEOUT"},
        )

    monkeypatch.setattr(lesson_service, "generate_lesson_markdown", _raise_llm_failure)

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "LLM_TIMEOUT"

    db_session.refresh(lesson)
    assert lesson.content_markdown is None


def test_generate_lesson_still_succeeds_when_youtube_lookup_fails(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Knife Skills")

    import app.services.lesson_service as lesson_service

    monkeypatch.setattr(
        lesson_service,
        "generate_lesson_markdown",
        lambda prompt: "## Knife Skills\n\n- Safety first",
    )

    def _raise_youtube_failure(*, query: str) -> str | None:
        _ = query
        raise RuntimeError("YouTube quota exceeded")

    monkeypatch.setattr(lesson_service, "fetch_youtube_video_id", _raise_youtube_failure)

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["lesson"]["id"] == lesson.id
    assert payload["lesson"]["content_markdown"] is not None
    assert payload["lesson"]["youtube_video_id"] is None

    db_session.refresh(lesson)
    assert lesson.content_markdown is not None
    assert lesson.youtube_video_id is None
