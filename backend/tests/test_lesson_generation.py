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

    def _fake_fetch_youtube_video_id(*, query: str, lesson=None, roadmap=None) -> str | None:
        _ = (lesson, roadmap)
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
    lowered_query = captured_query["value"].lower()
    assert "control flow" in lowered_query
    assert "python" in lowered_query
    assert "tutorial" in lowered_query
    assert "beginner" in lowered_query

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

    def _fake_fetch_youtube_video_id(*, query: str, lesson=None, roadmap=None) -> str | None:
        _ = (lesson, roadmap)
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
    lowered_query = captured_query["value"].lower()
    assert "relational data" in lowered_query
    assert "python roadmap" in lowered_query
    assert "tutorial" in lowered_query

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

    def _fake_fetch_youtube_video_id(*, query: str, lesson=None, roadmap=None) -> str | None:
        _ = (lesson, roadmap)
        captured_query["value"] = query
        return "dQw4w9WgXcQ"

    monkeypatch.setattr(lesson_service, "fetch_youtube_video_id", _fake_fetch_youtube_video_id)

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 200

    assert "c#" in captured_query["value"].lower()
    assert "tutorial" in captured_query["value"].lower()


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
    assert "youtube_search_query BAT BUOC viet bang TIENG ANH" in prompt


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

    def _fake_fetch_youtube_video_id(*, query: str, lesson=None, roadmap=None) -> str | None:
        _ = (lesson, roadmap)
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
    assert captured_params["videoCategoryId"] == "27,28"
    assert captured_params["maxResults"] == 5


def test_fetch_youtube_video_id_fallbacks_when_multi_category_not_supported(monkeypatch) -> None:
    import app.services.lesson_service as lesson_service

    category_calls: list[str | None] = []

    monkeypatch.setattr(
        lesson_service,
        "get_settings",
        lambda: type("_Settings", (), {"youtube_api_key": "fake-key"})(),
    )

    class FakeResponse:
        def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
            self.status_code = status_code
            self._payload = payload or {}
            self.text = text

        def json(self) -> dict:
            return self._payload

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
            category = params.get("videoCategoryId")
            category_calls.append(category)

            if category == "27,28":
                return FakeResponse(status_code=400, text="invalid videoCategoryId")

            return FakeResponse(
                status_code=200,
                payload={
                    "items": [
                        {
                            "id": {"videoId": "dQw4w9WgXcQ"},
                            "snippet": {"title": "C# tutorial", "description": "", "channelTitle": "Dev"},
                        }
                    ]
                },
            )

    monkeypatch.setattr(lesson_service.httpx, "Client", FakeClient)

    lesson = Lesson(
        roadmap_id=1,
        week_number=2,
        position=1,
        title="Thuoc tinh va truong",
        content_markdown=None,
        is_completed=False,
    )
    roadmap = Roadmap(user_id=1, goal="Toi muon hoc C#", title="Lo trinh C#", is_active=True)

    video_id = lesson_service.fetch_youtube_video_id(
        query="C# properties and fields tutorial for beginners",
        lesson=lesson,
        roadmap=roadmap,
    )

    assert video_id == "dQw4w9WgXcQ"
    assert category_calls[0] == "27,28"
    assert category_calls[1] in {"27", "28"}


def test_fetch_youtube_video_id_returns_none_when_all_candidates_irrelevant(monkeypatch) -> None:
    import app.services.lesson_service as lesson_service

    monkeypatch.setattr(
        lesson_service,
        "get_settings",
        lambda: type("_Settings", (), {"youtube_api_key": "fake-key"})(),
    )

    class FakeResponse:
        status_code = 200
        text = ""

        def json(self) -> dict:
            return {
                "items": [
                    {
                        "id": {"videoId": "movie001"},
                        "snippet": {
                            "title": "Phim co trang chien truong tinh yeu tap 1",
                            "description": "phim drama co trang hot",
                            "channelTitle": "Giai Tri Tong Hop",
                        },
                    },
                    {
                        "id": {"videoId": "music001"},
                        "snippet": {
                            "title": "Nhac remix cuc hay 2026",
                            "description": "karaoke reaction",
                            "channelTitle": "Music Plus",
                        },
                    },
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
            _ = (url, params)
            return FakeResponse()

    monkeypatch.setattr(lesson_service.httpx, "Client", FakeClient)

    lesson = Lesson(
        roadmap_id=1,
        week_number=2,
        position=1,
        title="Thuoc tinh va truong",
        content_markdown=None,
        is_completed=False,
    )
    roadmap = Roadmap(user_id=1, goal="Toi muon hoc C#", title="Lo trinh C#", is_active=True)

    selected_video_id = lesson_service.fetch_youtube_video_id(
        query="C# properties and fields tutorial for beginners",
        lesson=lesson,
        roadmap=roadmap,
    )
    assert selected_video_id is None


def test_fetch_youtube_video_id_selects_correct_video_for_properties_and_fields(monkeypatch) -> None:
    import app.services.lesson_service as lesson_service

    monkeypatch.setattr(
        lesson_service,
        "get_settings",
        lambda: type("_Settings", (), {"youtube_api_key": "fake-key"})(),
    )

    class FakeResponse:
        status_code = 200
        text = ""

        def json(self) -> dict:
            return {
                "items": [
                    {
                        "id": {"videoId": "movie001"},
                        "snippet": {
                            "title": "Chien truong tinh yeu - phim co trang",
                            "description": "drama phim bo",
                            "channelTitle": "Phim Moi",
                        },
                    },
                    {
                        "id": {"videoId": "tech0011"},
                        "snippet": {
                            "title": "C# Properties and Fields Tutorial for Beginners",
                            "description": "Learn C# fields, properties, int, string and OOP basics",
                            "channelTitle": "Programming with Mentor",
                        },
                    },
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
            _ = (url, params)
            return FakeResponse()

    monkeypatch.setattr(lesson_service.httpx, "Client", FakeClient)

    lesson = Lesson(
        roadmap_id=1,
        week_number=2,
        position=1,
        title="Thuoc tinh va truong",
        content_markdown=None,
        is_completed=False,
    )
    roadmap = Roadmap(user_id=1, goal="Toi muon hoc C#", title="Lo trinh C#", is_active=True)

    selected_video_id = lesson_service.fetch_youtube_video_id(
        query="C# properties and fields tutorial for beginners",
        lesson=lesson,
        roadmap=roadmap,
    )
    assert selected_video_id == "tech0011"


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

    def _raise_youtube_failure(*, query: str, lesson=None, roadmap=None) -> str | None:
        _ = (lesson, roadmap)
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

# The above tests cover various scenarios of the lesson generation process, including successful generation, handling of LLM failures, and ensuring that YouTube video selection logic works as intended.