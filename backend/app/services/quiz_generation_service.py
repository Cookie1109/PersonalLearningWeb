from __future__ import annotations

import json
import logging
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import ValidationError

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.schemas import QuizResponseDTO

logger = logging.getLogger("app.quiz_generation")
QUIZ_TOTAL_QUESTIONS = 10

QUIZ_FALLBACK_MODELS: tuple[str, ...] = (
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
)

DOMAIN_TECHNICAL = "technical"
DOMAIN_GENERAL = "general"

QUIZ_DISTRIBUTION_BY_DOMAIN: dict[str, dict[str, int]] = {
    DOMAIN_TECHNICAL: {
        "theory": 4,
        "fill_code": 3,
        "find_bug": 3,
    },
    DOMAIN_GENERAL: {
        "general_choice": 7,
        "fill_blank": 3,
    },
}

QUIZ_SYSTEM_PROMPT = (
    "Ban la mot chuyen gia thiet ke chuong trinh giang day va Senior Backend Developer. "
    "Nhiem vu cua ban la doc DU LIEU DAU VAO va tao ra MOT BO TRAC NGHIEM DUNG 10 CAU HOI chuyen sau. "
    "Khong dung kien thuc ngoai le.\n\n"
    "THEP RULE 1 - STRICT GROUNDING (RANG BUOC TUYET DOI): "
    "Ban CHI DUOC PHEP tao cau hoi dua tren noi dung TEXT DUOC CUNG CAP. TUYET DOI KHONG su dung kien thuc lap trinh ben ngoai hoac tu suy dien. "
    "Neu tai lieu chi noi ve uu diem cua SSR thi chi duoc hoi ve uu diem, KHONG do cach viet code SSR neu text khong co code.\n\n"
    "THEP RULE 2 - CODE DETECTION RULE (LUAT SINH CODE): "
    "Truoc khi sinh cau hoi, phai kiem tra tai lieu co CODE BLOCK THUC SU (duoc bao trong ```...```) hay khong. "
    "NEU CO CODE BLOCK: duoc phep sinh fill_code. "
    "NEU KHONG CO CODE BLOCK: day la bai LY THUYET, chi duoc sinh cau hoi khai niem (multiple choice/fill_blank theo noi dung ly thuyet) va NGHIEM CAM tao cau hoi code.\n\n"
    "THEP RULE 3 - QUALITY CHECK: "
    "Moi cau hoi bat buoc co dap an tim thay ro rang trong mot cau van cu the cua tai lieu duoc cung cap.\n\n"
    "THEP RULE 4 - SMART BLANKING (DUC LO THONG MINH): "
    "Doi voi cau hoi fill_blank, TUYET DOI KHONG DUOC de sot cac tu viet tat (acronym) hoac tu dong nghia nam trong ngoac don ngay canh cho trong ___. "
    "Neu an tu 'Lien Hiep Quoc' thi BAT BUOC phai xoa/che luon '(LHQ)' di kem de tranh lo dap an.\n\n"
    "BUOC 1: PHAN LOAI TAI LIEU\n"
    "Hay doc tai lieu va xac dinh no theo CODE BLOCK:\n"
    "- NHOM A (IT & Lap trinh): Tai lieu co code block thuc su ```...```\n"
    "- NHOM B (Phi ky thuat/ly thuyet): Tai lieu KHONG co code block thuc su ```...```\n\n"
    "BUOC 2: RE NHANH CAU TRUC 10 CAU HOI\n"
    "[NEU LA NHOM A - IT & LAP TRINH]:\n"
    "- Bat buoc sinh DUNG 10 cau gom: 4 cau 'theory', 3 cau 'fill_code', 3 cau 'find_bug'.\n"
    "- VOI fill_code: cau hoi bat buoc co huong dan ro rang va cho trong ___.\n"
    "- QUY TAC RENDER MARKDOWN TRONG JSON: KHI VIET CODE BLOCK (```javascript) BEN TRONG TRUONG question, BAN BAT BUOC PHAI SU DUNG KY TU NGAT DONG \\n THUC SU TRONG CHUOI JSON DE TACH BIET CAC DONG CODE. TUYET DOI KHONG VIET TOAN BO CODE BLOCK DINH LIEN TREN 1 DONG.\n"
    "- BAT BUOC CAU TRUC TRUONG question PHAI CO 2 PHAN: cau huong dan + code block.\n"
    "- VI DU MAU CHUAN BAT BUOC LAM THEO:\n"
    "\"Dien vao cho trong ___ de hoan thanh doan code sau:\\n```javascript\\nconst app = express();\\napp.get('/', (req, res) => {\\n  ___('Hello');\\n});\\n```\"\n"
    "- Truong options cua fill_code chi chua tu khoa/ten ham/doan code rat ngan de dien vua cho trong.\n"
    "- VOI find_bug: dua doan code sai logic nhu production, TUYET DOI KHONG CHUA COMMENT GOI Y (khong dung //).\n"
    "- VI DU DOAN CODE CHUAN (KHONG CO COMMENT RAC):\n"
    "\"```javascript\\napp.use((req, res) => {\\n  console.log('Log');\\n});\\napp.get('/', (req, res) => { res.send('OK'); });\\n```\"\n\n"
    "[NEU LA NHOM B - PHI KY THUAT]:\n"
    "- TUYET DOI KHONG SINH CAU HOI CODE.\n"
    "- Bat buoc sinh DUNG 10 cau gom: 7 cau 'general_choice', 3 cau 'fill_blank'.\n"
    "- VOI fill_blank: trich 1 cau quan trong trong tai lieu, duc lo 1 tu khoa bang ___, va tao 4 lua chon la 4 tu khoa cung chu de.\n"
    "- SMART BLANKING BAT BUOC: khong de lai bat ky acronym/tu dong nghia trong ngoac don sat canh cho trong ___.\n"
    "- Cac cau hoi phai duoc viet theo ngu canh ly thuyet/doc hieu, khong ep cu phap lap trinh.\n\n"
    "TRUONG 'type' BAT BUOC PHAI VIET THUONG TOAN BO: 'theory', 'fill_code', 'find_bug', 'general_choice', 'fill_blank'.\n\n"
    "PHAN OPTIONS/CORRECT_ANSWER: TUYET DOI KHONG THEM CAC TIEN TO 'A.', 'B.', 'C.', 'D.' O DAU CHUOI. "
    "HE THONG UI DA TU DONG XU LY VIEC NAY. VI DU CHUAN: \"options\": [\"req.body\", \"req.query\"], \"correct_answer\": \"req.query\".\n\n"
    "RANG BUOC COT LOI:\n"
    "- Co tinh tao ra cac dap an sai (distractors) dua tren loi thuong gap cua sinh vien. Dung lam dap an sai qua ngo ngan.\n"
    "- Doan code o dap an dung phai compile/run duoc, khong bi loi syntax.\n"
    "- Giai thich chi tiet tai sao dung va tai sao sai.\n\n"
    "DINH DANG DAU RA:\n"
    "Tra ve MOT MANG JSON CHUAN chua 10 object. Moi object co cau truc:\n"
    "{\n"
    "  \"id\": 1,\n"
    "  \"type\": \"theory | fill_code | find_bug | general_choice | fill_blank\",\n"
    "  \"difficulty\": \"Easy | Medium | Hard\",\n"
    "  \"question\": \"Noi dung cau hoi...\",\n"
    "  \"options\": [\"Lua chon 1\", \"Lua chon 2\", \"Lua chon 3\", \"Lua chon 4\"],\n"
    "  \"correct_answer\": \"Lua chon dung\",\n"
    "  \"explanation\": \"Giai thich chi tiet...\"\n"
    "}"
)

CODE_FENCE_PATTERN = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.IGNORECASE | re.DOTALL)
CODE_BLOCK_DETECTION_PATTERN = re.compile(
    r"```[a-zA-Z0-9_+\-]*\s*([\s\S]*?)```",
    re.IGNORECASE,
)
CODE_SIGNAL_IN_BLOCK_PATTERN = re.compile(
    r"[{}();]|=>|<=|>=|==|!=|\b(const|let|var|def|class|function|import|from|return|if|for|while|select|insert|update|delete|create|alter|drop|join|where)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class GeneratedQuizQuestion:
    question: str
    options: list[str]
    correct_index: int
    explanation: str
    question_id: int | None = None
    question_type: str | None = None
    difficulty: str | None = None
    correct_answer: str | None = None


def _normalize_model_name(raw_model: str) -> str:
    model = (raw_model or "").strip()
    if model.startswith("models/"):
        model = model.split("/", 1)[1]

    legacy_map = {
        "gemini-1.5-flash": "gemini-2.5-flash",
        "gemini-1.5-pro": "gemini-2.5-pro",
    }
    return legacy_map.get(model, model)


def _build_quiz_model_candidates(settings) -> list[str]:
    configured_quiz_model = (settings.gemini_quiz_model or "").strip() or "gemini-2.5-flash"
    configured_flash_model = (settings.gemini_model or "").strip() or "gemini-2.5-flash"

    candidates: list[str] = []
    for candidate in (
        configured_quiz_model,
        _normalize_model_name(configured_quiz_model),
        configured_flash_model,
        _normalize_model_name(configured_flash_model),
        *QUIZ_FALLBACK_MODELS,
    ):
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    return candidates


def build_quiz_prompt(*, lesson_title: str, source_content: str, has_code_blocks: bool = False) -> str:
    code_block_status = "CO" if has_code_blocks else "KHONG"
    return (
        "DU LIEU DAU VAO:\n"
        f"- Tieu de tai lieu: {lesson_title.strip()}\n"
        f"- Ket qua kiem tra code block thuc su: {code_block_status}\n"
        "- Nguon su that duy nhat (source_content):\n"
        f"{source_content.strip()[:50000]}"
    )


def _has_real_code_blocks(*, source_content: str) -> bool:
    if not source_content:
        return False

    for match in CODE_BLOCK_DETECTION_PATTERN.finditer(source_content):
        block = (match.group(1) or "").strip()
        if not block:
            continue

        normalized_block = re.sub(r"\s+", " ", block)
        if len(normalized_block) < 6:
            continue

        if "\n" in block or CODE_SIGNAL_IN_BLOCK_PATTERN.search(block):
            return True

    return False


def _classify_document_domain(*, lesson_title: str, source_content: str) -> str:
    _ = lesson_title
    return DOMAIN_TECHNICAL if _has_real_code_blocks(source_content=source_content) else DOMAIN_GENERAL


def _build_domain_distribution_instruction(domain: str) -> str:
    if domain == DOMAIN_TECHNICAL:
        return (
            "RANG BUOC DOMAIN NHOM A (IT): DUNG 10 CAU = 4 theory + 3 fill_code + 3 find_bug. "
            "Khong duoc sinh general_choice hoac fill_blank."
        )
    return (
        "RANG BUOC DOMAIN NHOM B (Phi ky thuat): DUNG 10 CAU = 7 general_choice + 3 fill_blank. "
        "TUYET DOI KHONG duoc sinh fill_code hoac find_bug."
    )


def _validate_generated_quiz_for_domain(*, questions: list[GeneratedQuizQuestion], domain: str) -> None:
    expected_distribution = QUIZ_DISTRIBUTION_BY_DOMAIN.get(domain, QUIZ_DISTRIBUTION_BY_DOMAIN[DOMAIN_TECHNICAL])

    missing_type = [item for item in questions if not item.question_type]
    if missing_type:
        raise ValueError("Each generated question must include a valid type")

    actual_distribution = Counter(str(item.question_type) for item in questions)

    for question_type, expected_count in expected_distribution.items():
        actual_count = actual_distribution.get(question_type, 0)
        if actual_count != expected_count:
            raise ValueError(f"Invalid distribution for {question_type}: expected {expected_count}, got {actual_count}")

    disallowed_types = [
        question_type
        for question_type, actual_count in actual_distribution.items()
        if actual_count > 0 and question_type not in expected_distribution
    ]
    if disallowed_types:
        raise ValueError(f"Disallowed question types for domain {domain}: {', '.join(disallowed_types)}")


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


def _extract_finish_reason(payload: dict[str, Any]) -> str | None:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return None

    first_candidate = candidates[0]
    if not isinstance(first_candidate, dict):
        return None

    finish_reason = first_candidate.get("finishReason")
    return finish_reason if isinstance(finish_reason, str) else None


def _extract_provider_error_message(response: httpx.Response) -> str | None:
    try:
        response_payload = response.json()
    except ValueError:
        return None

    if not isinstance(response_payload, dict):
        return None

    error_payload = response_payload.get("error")
    if not isinstance(error_payload, dict):
        return None

    message = error_payload.get("message")
    if isinstance(message, str) and message.strip():
        return message.strip()

    status = error_payload.get("status")
    if isinstance(status, str) and status.strip():
        return status.strip()

    return None


def _extract_json_candidate_text(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if not text:
        return ""

    if text.startswith("```"):
        block_match = CODE_FENCE_PATTERN.search(text)
        if block_match:
            text = block_match.group(1).strip()

    array_start = text.find("[")
    array_end = text.rfind("]")
    if array_start != -1 and array_end != -1 and array_end > array_start:
        return text[array_start : array_end + 1]

    object_start = text.find("{")
    object_end = text.rfind("}")
    if object_start != -1 and object_end != -1 and object_end > object_start:
        return text[object_start : object_end + 1]

    return text


def _extract_question_items(raw_payload: Any) -> list[Any] | None:
    if isinstance(raw_payload, list):
        return raw_payload

    if not isinstance(raw_payload, dict):
        return None

    for key in ("questions", "quiz", "items", "data"):
        value = raw_payload.get(key)
        if isinstance(value, list):
            return value

    return None


def _build_quiz_generation_payload(*, user_prompt: str) -> dict[str, Any]:
    return {
        "systemInstruction": {
            "role": "user",
            "parts": [{"text": QUIZ_SYSTEM_PROMPT}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 8192,
            "responseMimeType": "application/json",
        },
    }


def _build_quiz_repair_payload(*, user_prompt: str, invalid_json: str, error_message: str, domain: str) -> dict[str, Any]:
    repair_prompt = (
        "Ban vua tra ve JSON quiz khong hop le. "
        "HAY TRA VE LAI MOT MANG JSON HOP LE DUY NHAT, DUNG 10 OBJECT, KHONG THEM VAN BAN GIAI THICH. "
        "TRUONG 'type' BAT BUOC PHAI VIET THUONG: 'theory', 'fill_code', 'find_bug', 'general_choice', 'fill_blank'. "
        f"{_build_domain_distribution_instruction(domain)} "
        "TUYET DOI KHONG THEM TIEN TO 'A.', 'B.', 'C.', 'D.' TRONG options va correct_answer. "
        "VOI fill_code, MO DAU question BAT BUOC: 'Dien vao cho trong ___ de hoan thanh doan code sau:'. "
        "KHI VIET CODE BLOCK TRONG question, BAT BUOC DUNG KY TU NGAT DONG \\n THUC SU, KHONG DUOC DINH CODE BLOCK TREN MOT DONG. "
        "VOI find_bug, TUYET DOI KHONG CHEN COMMENT GOI Y LOI TRONG CODE. "
        "VOI fill_blank, question bat buoc co cho trong ___ va options la 4 tu khoa. "
        "TRUONG 'difficulty' BAT BUOC: 'Easy' | 'Medium' | 'Hard'.\n\n"
        f"Ly do JSON khong hop le: {error_message}\n\n"
        "Du lieu JSON loi can sua:\n"
        f"{invalid_json[:12000]}"
    )

    return {
        "systemInstruction": {
            "role": "user",
            "parts": [{"text": QUIZ_SYSTEM_PROMPT}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            },
            {
                "role": "model",
                "parts": [{"text": invalid_json[:12000]}],
            },
            {
                "role": "user",
                "parts": [{"text": repair_prompt}],
            },
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 8192,
            "responseMimeType": "application/json",
        },
    }


def parse_generated_quiz(raw_text: str) -> list[GeneratedQuizQuestion]:
    text = _extract_json_candidate_text((raw_text or "").strip())
    if not text:
        raise ValueError("Empty model output")

    raw_payload = json.loads(text)
    question_items = _extract_question_items(raw_payload)
    if question_items is None:
        raise ValueError("Quiz payload must be a JSON array or an object with questions")

    if len(question_items) > QUIZ_TOTAL_QUESTIONS:
        question_items = question_items[:QUIZ_TOTAL_QUESTIONS]

    dto_payload: dict[str, Any] = {"questions": question_items}

    validated = QuizResponseDTO.model_validate(dto_payload)
    if len(validated.questions) < QUIZ_TOTAL_QUESTIONS:
        raise ValueError(f"Quiz payload must contain exactly {QUIZ_TOTAL_QUESTIONS} questions")

    normalized: list[GeneratedQuizQuestion] = []
    for item in validated.questions:
        correct_index = item.options.index(item.correct_answer)
        normalized.append(
            GeneratedQuizQuestion(
                question=item.question,
                options=[str(option) for option in item.options],
                correct_index=correct_index,
                explanation=item.explanation,
                question_id=item.id,
                question_type=item.type,
                difficulty=item.difficulty,
                correct_answer=item.correct_answer,
            )
        )

    return normalized


def generate_quiz_questions(*, lesson_title: str, source_content: str) -> tuple[str, list[GeneratedQuizQuestion]]:
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        raise AppException(
            status_code=503,
            message="AI service is not configured",
            detail={"code": "LLM_API_KEY_MISSING"},
        )

    model_candidates = _build_quiz_model_candidates(settings)
    timeout_seconds = max(30.0, float(settings.gemini_timeout_seconds))
    has_code_blocks = _has_real_code_blocks(source_content=source_content)
    document_domain = DOMAIN_TECHNICAL if has_code_blocks else DOMAIN_GENERAL

    user_prompt = build_quiz_prompt(
        lesson_title=lesson_title,
        source_content=source_content,
        has_code_blocks=has_code_blocks,
    )
    request_payload = _build_quiz_generation_payload(user_prompt=user_prompt)
    saw_quota_or_rate_limit = False
    latest_quota_message: str | None = None
    last_ai_error: AppException | None = None

    with httpx.Client(timeout=timeout_seconds) as client:
        for index, model_name in enumerate(model_candidates):
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            has_fallback = index < len(model_candidates) - 1

            try:
                response = client.post(endpoint, params={"key": api_key}, json=request_payload)
            except httpx.TimeoutException as exc:
                if has_fallback:
                    continue
                last_ai_error = AppException(status_code=503, message="AI service timeout", detail={"code": "LLM_TIMEOUT"})
                break
            except httpx.RequestError as exc:
                if has_fallback:
                    continue
                last_ai_error = AppException(status_code=503, message="AI service network error", detail={"code": "LLM_NETWORK_ERROR"})
                break

            if response.status_code in (401, 403):
                last_ai_error = AppException(
                    status_code=503,
                    message="AI service authentication failed",
                    detail={"code": "LLM_AUTH_FAILED"},
                )
                break

            provider_error_message = _extract_provider_error_message(response)

            if response.status_code == 429:
                saw_quota_or_rate_limit = True
                latest_quota_message = provider_error_message or latest_quota_message

                if has_fallback:
                    logger.warning(
                        "quiz_generation.rate_limited_try_fallback model=%s error=%s",
                        model_name,
                        provider_error_message,
                    )
                    continue

                last_ai_error = AppException(
                    status_code=503,
                    message="AI quota exceeded",
                    detail={
                        "code": "LLM_QUOTA_EXCEEDED",
                        "status_code": str(response.status_code),
                        "provider_message": provider_error_message,
                    },
                )
                break

            if response.status_code >= 400:
                if has_fallback and response.status_code in (404, 500, 503):
                    continue
                last_ai_error = AppException(
                    status_code=503,
                    message="AI service unavailable",
                    detail={
                        "code": "LLM_SERVICE_ERROR",
                        "status_code": str(response.status_code),
                        "provider_message": provider_error_message,
                    },
                )
                break

            try:
                response_json = response.json()
            except ValueError as exc:
                if has_fallback:
                    continue
                last_ai_error = AppException(
                    status_code=503,
                    message="AI service returned invalid response",
                    detail={"code": "LLM_INVALID_RESPONSE"},
                )
                break

            generated_text = _extract_gemini_text(response_json)
            if not generated_text:
                if has_fallback:
                    continue
                last_ai_error = AppException(
                    status_code=503,
                    message="AI service returned empty response",
                    detail={"code": "LLM_EMPTY_RESPONSE"},
                )
                break

            finish_reason = _extract_finish_reason(response_json)

            parse_error: Exception | None = None
            questions: list[GeneratedQuizQuestion] | None = None

            try:
                questions = parse_generated_quiz(generated_text)
                _validate_generated_quiz_for_domain(questions=questions, domain=document_domain)
            except (ValueError, json.JSONDecodeError, ValidationError) as exc:
                parse_error = exc
                logger.error(
                    "quiz_generation.invalid_json model=%s error=%s payload_preview=%s",
                    model_name,
                    str(exc),
                    generated_text[:800],
                    exc_info=True,
                )

            if questions is None:
                repair_payload = _build_quiz_repair_payload(
                    user_prompt=user_prompt,
                    invalid_json=generated_text,
                    error_message=str(parse_error) if parse_error is not None else "Unknown parse error",
                    domain=document_domain,
                )
                try:
                    repair_response = client.post(endpoint, params={"key": api_key}, json=repair_payload)
                    if repair_response.status_code < 400:
                        repair_payload_json = repair_response.json()
                        repaired_text = _extract_gemini_text(repair_payload_json)
                        if repaired_text:
                            questions = parse_generated_quiz(repaired_text)
                            _validate_generated_quiz_for_domain(questions=questions, domain=document_domain)
                except (ValueError, json.JSONDecodeError, ValidationError) as repair_parse_exc:
                    parse_error = repair_parse_exc
                    questions = None
                except Exception as repair_exc:
                    logger.warning("quiz_generation.repair_failed model=%s error=%s", model_name, str(repair_exc))

            if questions is not None:
                return model_name, questions

            if has_fallback:
                logger.warning(
                    "quiz_generation.try_fallback_model current_model=%s finish_reason=%s domain=%s",
                    model_name,
                    finish_reason,
                    document_domain,
                )
                continue

            last_ai_error = AppException(
                status_code=500,
                message="AI service returned invalid quiz JSON",
                detail={"code": "LLM_INVALID_QUIZ_JSON", "error": str(parse_error) if parse_error else "Unable to repair quiz JSON"},
            )
            break

    if saw_quota_or_rate_limit:
        raise AppException(
            status_code=503,
            message="AI quota exceeded",
            detail={
                "code": "LLM_QUOTA_EXCEEDED",
                "provider_message": latest_quota_message,
            },
        )

    if last_ai_error is not None:
        raise last_ai_error

    raise AppException(status_code=503, message="AI service unavailable", detail={"code": "LLM_SERVICE_ERROR"})
