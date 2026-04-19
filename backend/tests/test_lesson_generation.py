from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.models import Lesson, Roadmap


def _auth_headers_for_user(*, user) -> dict[str, str]:
    firebase_uid = user.firebase_uid or f"uid-{user.id}"
    token = f"test-firebase-token|{firebase_uid}|{user.email}"
    return {"Authorization": f"Bearer {token}"}


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
        user_id=user_id,
        roadmap_id=roadmap.id,
        week_number=1,
        position=1,
        title=title,
        source_content=f"Source content for {title}",
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

    owner_response = client.get(
        f"/api/lessons/{lesson.id}",
        headers=_auth_headers_for_user(user=owner),
    )

    assert owner_response.status_code == 200
    owner_payload = owner_response.json()
    assert owner_payload["id"] == lesson.id
    assert owner_payload["is_draft"] is True
    assert owner_payload["content_markdown"] is None
    assert owner_payload["youtube_video_id"] is None

    outsider_response = client.get(
        f"/api/lessons/{lesson.id}",
        headers=_auth_headers_for_user(user=outsider),
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
    generated_markdown = "## Control Flow\n\n### Khai niem then chot\n\n- if\n- for"

    import app.services.lesson_service as lesson_service

    monkeypatch.setattr(
        lesson_service,
        "generate_grounded_markdown",
        lambda *, prompt: generated_markdown,
    )

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["lesson"]["id"] == lesson.id
    assert payload["lesson"]["is_draft"] is False
    assert payload["lesson"]["content_markdown"] == generated_markdown
    assert payload["lesson"]["youtube_video_id"] is None

    db_session.refresh(lesson)
    assert lesson.content_markdown == generated_markdown
    assert lesson.youtube_video_id is None
    assert lesson.version == 2


def test_generate_lesson_returns_ai_error_when_llm_unavailable(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Relational Data")

    import app.services.lesson_service as lesson_service

    def _raise_llm_failure(*, prompt: str) -> str:
        _ = prompt
        raise AppException(
            status_code=503,
            message="AI service timeout",
            detail={"code": "LLM_TIMEOUT"},
        )

    monkeypatch.setattr(lesson_service, "generate_grounded_markdown", _raise_llm_failure)

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 500

    payload = response.json()
    assert payload["message"].startswith("He thong AI gap loi:")
    assert payload["detail"]["code"] == "THEORY_AI_FAILED"
    assert payload["detail"]["upstream_code"] == "LLM_TIMEOUT"

    db_session.refresh(lesson)
    assert lesson.content_markdown is None
    assert lesson.youtube_video_id is None


def test_build_document_theory_prompt_enforces_grounding_contract() -> None:
    import app.services.lesson_service as lesson_service

    prompt = lesson_service.build_document_theory_prompt(
        title="Data Structures",
        source_content="Stack la cau truc LIFO. Co thao tac push va pop.",
    )

    assert "quy trình \"Chắt lọc Sư phạm\" gồm 4 bước bắt buộc" in prompt
    assert "BƯỚC 1: LỌC NHIỄU (NOISE REDUCTION)" in prompt
    assert "BƯỚC 2: TÁI CẤU TRÚC (RESTRUCTURING)" in prompt
    assert "BƯỚC 3: BẢO TOÀN KỸ THUẬT (TECHNICAL PRESERVATION) - RẤT QUAN TRỌNG" in prompt
    assert "BƯỚC 4: ĐỊNH DẠNG HIỂN THỊ (WHITESPACE FORMATTING)" in prompt
    assert "2 DẤU XUỐNG DÒNG (\\n\\n)" in prompt
    assert "tuyệt đối không bịa đặt thêm kiến thức ngoài" in prompt
    assert "QUY TẮC BẮT BUỘC (CRITICAL): KHÔNG ĐƯỢC sử dụng các câu chào hỏi" in prompt


def test_generate_grounded_markdown_maps_prompt_to_payload_parts_text(monkeypatch) -> None:
    import app.services.lesson_service as lesson_service

    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_pro_model = "gemini-1.5-pro"

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json() -> dict:
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": "## Ket qua markdown"},
                            ]
                        }
                    }
                ]
            }

    captured_payload: dict[str, object] = {}

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
            captured_payload["json"] = json
            return FakeResponse()

    monkeypatch.setattr(lesson_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(lesson_service.httpx, "Client", FakeClient)

    raw_prompt = "PROMPT_PEDAGOGICAL_DISTILLATION"
    output = lesson_service.generate_grounded_markdown(prompt=raw_prompt)

    assert output == "## Ket qua markdown"
    assert captured_payload["json"] == {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": raw_prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 8192,
        },
    }


def test_generate_grounded_markdown_strips_chatty_preamble_and_extends_truncated_output(monkeypatch) -> None:
    import app.services.lesson_service as lesson_service

    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_pro_model = "gemini-1.5-pro"

    class FakeResponse:
        def __init__(self, payload: dict):
            self.status_code = 200
            self._payload = payload

        def json(self) -> dict:
            return self._payload

    payloads_sent: list[dict[str, object]] = []

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
            payloads_sent.append(json)

            if len(payloads_sent) == 1:
                return FakeResponse(
                    {
                        "candidates": [
                            {
                                "finishReason": "MAX_TOKENS",
                                "content": {
                                    "parts": [
                                        {
                                            "text": (
                                                "Tuyet voi! Duoi day la bai giang cua ban.\n\n"
                                                "# Chiến tranh thế giới thứ nhất\n\n"
                                                "## Boi canh\n\n"
                                                "Chiến tranh thế giới thứ nhất diễn ra từ năm 1914 đến"
                                            )
                                        }
                                    ]
                                },
                            }
                        ]
                    }
                )

            return FakeResponse(
                {
                    "candidates": [
                        {
                            "finishReason": "STOP",
                            "content": {
                                "parts": [
                                    {
                                        "text": (
                                            "năm 1918.\n\n"
                                            "## He qua\n\n"
                                            "Ban do chinh tri chau Au thay doi sau rong."
                                        )
                                    }
                                ]
                            },
                        }
                    ]
                }
            )

    monkeypatch.setattr(lesson_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(lesson_service.httpx, "Client", FakeClient)

    ww1_text = (
        "Chiến tranh thế giới thứ nhất là cuộc xung đột quân sự toàn cầu từ năm 1914 đến 1918, "
        "chủ yếu diễn ra tại châu Âu và có sự tham gia của nhiều cường quốc."
    )
    prompt = lesson_service.build_document_theory_prompt(
        title="Chiến tranh thế giới thứ nhất",
        source_content=ww1_text,
    )

    output = lesson_service.generate_grounded_markdown(prompt=prompt)

    assert output.startswith("# Chiến tranh thế giới thứ nhất")
    assert output.endswith("Ban do chinh tri chau Au thay doi sau rong.")
    assert "Tuyet voi!" not in output
    assert len(payloads_sent) >= 2
    assert payloads_sent[0]["generationConfig"]["maxOutputTokens"] == 8192
    assert payloads_sent[1]["generationConfig"]["maxOutputTokens"] == 8192


def test_generate_lesson_returns_controlled_error_when_llm_fails(
    client,
    db_session: Session,
    auth_headers,
) -> None:
    user, headers = auth_headers
    lesson = _seed_lesson(db_session, user_id=user.id, title="Error Handling")

    lesson.source_content = ""
    db_session.commit()

    response = client.post(f"/api/lessons/{lesson.id}/generate", json={}, headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "LESSON_SOURCE_EMPTY"

    db_session.refresh(lesson)
    assert lesson.content_markdown is None
