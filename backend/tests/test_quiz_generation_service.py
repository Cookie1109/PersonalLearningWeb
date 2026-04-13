from __future__ import annotations

import json

import pytest

from app.core.exceptions import AppException
from app.services import quiz_generation_service


def _build_question_payload(index: int) -> dict[str, object]:
    option_a = f"A. option {index}"
    option_b = f"B. option {index}"
    option_c = f"C. option {index}"
    option_d = f"D. option {index}"
    return {
        "id": index,
        "type": "theory" if index <= 4 else ("fill_code" if index <= 7 else "find_bug"),
        "difficulty": "Easy" if index <= 3 else ("Medium" if index <= 7 else "Hard"),
        "question": f"Question {index}",
        "options": [option_a, option_b, option_c, option_d],
        "correct_answer": option_b,
        "explanation": f"Explanation {index}",
    }


def _build_general_question_payload(index: int) -> dict[str, object]:
    option_a = f"A. keyword {index}-A"
    option_b = f"B. keyword {index}-B"
    option_c = f"C. keyword {index}-C"
    option_d = f"D. keyword {index}-D"

    question_type = "general_choice" if index <= 7 else "fill_blank"
    question_text = (
        f"Cau hoi ly thuyet tong quat so {index}"
        if question_type == "general_choice"
        else f"Trong nam 1945, su kien ___ danh dau ket thuc chien tranh the gioi thu hai (cau {index})."
    )

    return {
        "id": index,
        "type": question_type,
        "difficulty": "Easy" if index <= 3 else ("Medium" if index <= 7 else "Hard"),
        "question": question_text,
        "options": [option_a, option_b, option_c, option_d],
        "correct_answer": option_b,
        "explanation": f"Explanation general {index}",
    }


def _build_quiz_array_json() -> str:
    return json.dumps([_build_question_payload(index) for index in range(1, 11)], ensure_ascii=False)


def _build_general_quiz_array_json() -> str:
    return json.dumps([_build_general_question_payload(index) for index in range(1, 11)], ensure_ascii=False)


def test_generate_quiz_questions_uses_json_mode_and_returns_10_questions(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_request_payload: dict[str, object] = {}

    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_quiz_model = "gemini-2.5-flash"

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": _build_quiz_array_json(),
                                }
                            ]
                        }
                    }
                ]
            }

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
            captured_request_payload["payload"] = json
            return FakeResponse()

    monkeypatch.setattr(quiz_generation_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(quiz_generation_service.httpx, "Client", FakeClient)

    model_name, questions = quiz_generation_service.generate_quiz_questions(
        lesson_title="Async Patterns",
        source_content="Event loop, await, gather, and timeout handling.",
    )

    assert model_name == "gemini-2.5-flash"
    assert len(questions) == 10

    request_payload = captured_request_payload["payload"]
    generation_config = request_payload["generationConfig"]
    assert generation_config["responseMimeType"] == "application/json"
    assert "systemInstruction" in request_payload
    system_text = request_payload["systemInstruction"]["parts"][0]["text"]
    assert "BUOC 1: PHAN LOAI TAI LIEU" in system_text
    assert "NHOM A (IT & Lap trinh)" in system_text
    assert "NHOM B (Phi ky thuat)" in system_text
    assert "BUOC 2: RE NHANH CAU TRUC 10 CAU HOI" in system_text
    assert "4 cau 'theory', 3 cau 'fill_code', 3 cau 'find_bug'" in system_text
    assert "7 cau 'general_choice', 3 cau 'fill_blank'" in system_text
    assert "QUY TAC RENDER MARKDOWN TRONG JSON" in system_text
    assert "\\n THUC SU TRONG CHUOI JSON" in system_text
    assert "___('Hello');" in system_text


def test_generate_quiz_questions_raises_500_on_invalid_json(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_quiz_model = "gemini-2.5-flash"

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": "this-is-not-json",
                                }
                            ]
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, timeout: float):
            _ = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

        def post(self, endpoint: str, *, params: dict[str, str], json: dict[str, object]):
            _ = (endpoint, params, json)
            return FakeResponse()

    monkeypatch.setattr(quiz_generation_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(quiz_generation_service.httpx, "Client", FakeClient)

    with pytest.raises(AppException) as exc_info:
        quiz_generation_service.generate_quiz_questions(
            lesson_title="Failing Quiz",
            source_content="Only for validation path.",
        )

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail["code"] == "LLM_INVALID_QUIZ_JSON"


def test_parse_generated_quiz_normalizes_type_and_whitespace() -> None:
    payload = []
    for index in range(1, 11):
        item = _build_question_payload(index)
        if index == 1:
            item["type"] = "Theory"
            item["options"] = [" A. first ", " B. second ", " C. third ", " D. fourth "]
            item["correct_answer"] = " B. second "
        payload.append(item)

    questions = quiz_generation_service.parse_generated_quiz(json.dumps(payload, ensure_ascii=False))
    assert len(questions) == 10
    assert questions[0].question_type == "theory"
    assert questions[0].options[1] == "second"
    assert questions[0].correct_answer == "second"
    assert questions[0].correct_index == 1


def test_parse_generated_quiz_trims_extra_questions() -> None:
    payload = [_build_question_payload(index) for index in range(1, 13)]
    questions = quiz_generation_service.parse_generated_quiz(json.dumps(payload, ensure_ascii=False))
    assert len(questions) == 10
    assert questions[-1].question_id == 10


def test_parse_generated_quiz_normalizes_single_line_code_fence_question() -> None:
    payload = [_build_question_payload(index) for index in range(1, 11)]
    payload[4]["type"] = "fill_code"
    payload[4]["question"] = (
        "Dien vao cho trong ___ de hoan thanh doan code sau: "
        "```javascript const app = express(); app.get('/', (req, res) => { ___('Hello'); }); ```"
    )

    questions = quiz_generation_service.parse_generated_quiz(json.dumps(payload, ensure_ascii=False))

    assert "\n```javascript\n" in questions[4].question
    assert "___('Hello');" in questions[4].question
    assert questions[4].question.endswith("```")


def test_generate_quiz_questions_repairs_malformed_json(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_quiz_model = "gemini-2.5-flash"

    class FakeResponse:
        def __init__(self, payload: dict[str, object], status_code: int = 200):
            self._payload = payload
            self.status_code = status_code

        def json(self) -> dict[str, object]:
            return self._payload

    malformed_json = _build_quiz_array_json()[:-10]
    response_queue = [
        FakeResponse(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": malformed_json}],
                        }
                    }
                ]
            }
        ),
        FakeResponse(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": _build_quiz_array_json()}],
                        }
                    }
                ]
            }
        ),
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
            _ = (endpoint, params, json)
            return response_queue.pop(0)

    monkeypatch.setattr(quiz_generation_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(quiz_generation_service.httpx, "Client", FakeClient)

    model_name, questions = quiz_generation_service.generate_quiz_questions(
        lesson_title="Repair Test",
        source_content="event loop middleware route handler" * 200,
    )

    assert model_name == "gemini-2.5-flash"
    assert len(questions) == 10


def test_generate_quiz_questions_with_express_document_keeps_code_oriented_types(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_quiz_model = "gemini-2.5-flash"

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": _build_quiz_array_json()}],
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, timeout: float):
            _ = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

        def post(self, endpoint: str, *, params: dict[str, str], json: dict[str, object]):
            _ = (endpoint, params, json)
            return FakeResponse()

    monkeypatch.setattr(quiz_generation_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(quiz_generation_service.httpx, "Client", FakeClient)

    _, questions = quiz_generation_service.generate_quiz_questions(
        lesson_title="ExpressJS Middleware",
        source_content="Express router middleware async handler req res next API endpoint database",
    )

    question_types = [question.question_type for question in questions]
    assert question_types.count("theory") == 4
    assert question_types.count("fill_code") == 3
    assert question_types.count("find_bug") == 3


def test_generate_quiz_questions_with_history_document_blocks_code_types(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_quiz_model = "gemini-2.5-flash"

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": _build_general_quiz_array_json()}],
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, timeout: float):
            _ = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

        def post(self, endpoint: str, *, params: dict[str, str], json: dict[str, object]):
            _ = (endpoint, params, json)
            return FakeResponse()

    monkeypatch.setattr(quiz_generation_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(quiz_generation_service.httpx, "Client", FakeClient)

    _, questions = quiz_generation_service.generate_quiz_questions(
        lesson_title="Lich su Chien tranh The gioi thu 2",
        source_content=(
            "Tai lieu lich su mo ta cac mat tran lon, hoi nghi dong minh, bien dong chinh tri chau Au "
            "va tac dong kinh te xa hoi trong giai doan 1939-1945."
        ),
    )

    question_types = [question.question_type for question in questions]
    assert question_types.count("general_choice") == 7
    assert question_types.count("fill_blank") == 3
    assert "fill_code" not in question_types
    assert "find_bug" not in question_types


def test_generate_quiz_questions_falls_back_to_secondary_model_on_404(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_quiz_model = "gemini-2.5-flash"

    class FakeResponse:
        def __init__(self, status_code: int, payload: dict[str, object]):
            self.status_code = status_code
            self._payload = payload

        def json(self) -> dict[str, object]:
            return self._payload

    class FakeClient:
        def __init__(self, timeout: float):
            _ = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

        def post(self, endpoint: str, *, params: dict[str, str], json: dict[str, object]):
            _ = (params, json)
            if "gemini-2.5-flash-lite" in endpoint:
                return FakeResponse(
                    200,
                    {
                        "candidates": [
                            {
                                "content": {
                                    "parts": [{"text": _build_quiz_array_json()}],
                                }
                            }
                        ]
                    },
                )
            if "gemini-2.5-flash" in endpoint:
                return FakeResponse(
                    404,
                    {
                        "error": {
                            "message": "Model not found",
                        }
                    },
                )
            return FakeResponse(500, {"error": {"message": "Unexpected model"}})

    monkeypatch.setattr(quiz_generation_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(quiz_generation_service.httpx, "Client", FakeClient)

    model_name, questions = quiz_generation_service.generate_quiz_questions(
        lesson_title="Fallback Model",
        source_content="Express route middleware async request response",
    )

    assert model_name == "gemini-2.5-flash-lite"
    assert len(questions) == 10


def test_generate_quiz_questions_returns_quota_exceeded_code_on_429(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeSettings:
        gemini_api_key = "test-key"
        gemini_timeout_seconds = 120.0
        gemini_model = "gemini-2.5-flash"
        gemini_quiz_model = "gemini-2.5-flash"

    class FakeResponse:
        status_code = 429

        @staticmethod
        def json() -> dict[str, object]:
            return {
                "error": {
                    "message": "You exceeded your current quota",
                }
            }

    class FakeClient:
        def __init__(self, timeout: float):
            _ = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

        def post(self, endpoint: str, *, params: dict[str, str], json: dict[str, object]):
            _ = (endpoint, params, json)
            return FakeResponse()

    monkeypatch.setattr(quiz_generation_service, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(quiz_generation_service.httpx, "Client", FakeClient)

    with pytest.raises(AppException) as exc_info:
        quiz_generation_service.generate_quiz_questions(
            lesson_title="Rate Limited",
            source_content="non technical history content",
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "LLM_QUOTA_EXCEEDED"


def test_classify_document_domain_detects_technical_content() -> None:
    domain = quiz_generation_service._classify_document_domain(
        lesson_title="Express Middleware",
        source_content=(
            "const app = express(); app.use((req, res, next) => next()); "
            "API endpoint router controller database query JSON"
        ),
    )

    assert domain == quiz_generation_service.DOMAIN_TECHNICAL


def test_classify_document_domain_detects_general_content() -> None:
    domain = quiz_generation_service._classify_document_domain(
        lesson_title="Lich su The gioi hien dai",
        source_content=(
            "Tai lieu trinh bay boi canh chinh tri chau Au, su kien ngoai giao, "
            "va tac dong xa hoi trong giai doan 1939-1945."
        ),
    )

    assert domain == quiz_generation_service.DOMAIN_GENERAL
