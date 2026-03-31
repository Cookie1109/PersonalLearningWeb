def test_graceful_cooldown_returns_429_after_four_failed_submissions(client, seed_quiz, auth_headers) -> None:
    _, quiz_id = seed_quiz
    _, headers = auth_headers

    wrong_payload = {
        "answers": [
            {"question_id": "q1", "selected_option": "A"},
            {"question_id": "q2", "selected_option": "A"},
        ]
    }

    for _ in range(4):
        response = client.post(f"/api/quizzes/{quiz_id}/submit", json=wrong_payload, headers=headers)
        assert response.status_code == 200
        assert response.json()["is_passed"] is False

    cooldown_response = client.post(f"/api/quizzes/{quiz_id}/submit", json=wrong_payload, headers=headers)
    assert cooldown_response.status_code == 429
    payload = cooldown_response.json()
    assert payload["detail"]["code"] == "QUIZ_COOLDOWN_ACTIVE"
    assert int(payload["detail"]["retry_after_seconds"]) > 0
