from __future__ import annotations

import json

from app.services import flashcard_generation_service


def test_flashcard_system_prompt_enforces_exhaustive_extraction_contract() -> None:
    prompt = flashcard_generation_service.FLASHCARD_SYSTEM_PROMPT

    assert "trích xuất TRIỆT ĐỂ" in prompt
    assert "TUYỆT ĐỐI KHÔNG tự ý giới hạn số lượng thẻ" in prompt
    assert "Có thể lên tới 50-100 thẻ" in prompt
    assert '[{"front": "...", "back": "..."}]' in prompt


def test_build_generation_payload_sets_high_max_output_tokens() -> None:
    payload = flashcard_generation_service._build_generation_payload(user_prompt="Tai lieu lich su")

    generation_config = payload["generationConfig"]
    assert generation_config["maxOutputTokens"] == 8192
    assert generation_config["responseMimeType"] == "application/json"
    assert payload["systemInstruction"]["parts"][0]["text"] == flashcard_generation_service.FLASHCARD_SYSTEM_PROMPT


def test_parse_generated_flashcards_keeps_all_valid_cards_without_hard_cap() -> None:
    raw_cards = [
        {
            "front": f"Moc su kien {index}",
            "back": f"Mo ta su kien quan trong so {index}.",
        }
        for index in range(1, 31)
    ]

    parsed_cards = flashcard_generation_service.parse_generated_flashcards(
        json.dumps(raw_cards, ensure_ascii=False)
    )

    assert len(parsed_cards) == 30
    assert parsed_cards[0].front_text == "Moc su kien 1"
    assert parsed_cards[-1].back_text == "Mo ta su kien quan trong so 30."


def test_build_flashcard_prompt_keeps_tail_content_for_long_documents() -> None:
    long_document = "Noi dung mo dau " + ("x" * 51000) + " TAIL_MUST_EXIST"

    prompt = flashcard_generation_service.build_flashcard_prompt(
        lesson_title="Chien tranh the gioi thu nhat",
        document_text=long_document,
    )

    assert "TAIL_MUST_EXIST" in prompt
