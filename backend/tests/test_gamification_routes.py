from __future__ import annotations

from app.core.config import get_settings


def test_gamification_profile_returns_progressive_level_snapshot(client, auth_headers, db_session) -> None:
    user, headers = auth_headers

    user.exp = 4500
    user.total_exp = 4500
    user.level = 99
    user.current_streak = 2
    user.streak = 2
    db_session.commit()

    response = client.get("/api/gamification/profile", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["level"] == 3
    assert payload["current_exp"] == 1500
    assert payload["target_exp"] == 3000
    assert payload["total_exp"] == 4500
    assert payload["current_streak"] == 2


def test_daily_quests_auto_generate_three_difficulties(client, auth_headers) -> None:
    _, headers = auth_headers

    response = client.get("/api/gamification/quests", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    quests = payload["quests"]

    assert len(quests) == 3
    assert {quest["difficulty"] for quest in quests} == {"easy", "medium", "hard"}
    assert payload["all_clear_completed"] is False


def test_track_updates_progress_and_rejects_duplicate_target(client, auth_headers) -> None:
    _, headers = auth_headers

    quests_response = client.get("/api/gamification/quests", headers=headers)
    assert quests_response.status_code == 200
    quest = quests_response.json()["quests"][0]

    payload = {
        "action_type": quest["action_type"],
        "target_id": f"{quest['quest_code']}-unit-target",
        "value": int(quest["target_value"]),
    }

    first_track = client.post("/api/gamification/track", headers=headers, json=payload)
    assert first_track.status_code == 200
    first_payload = first_track.json()
    assert first_payload["accepted"] is True
    assert first_payload["exp_gained"] > 0
    assert any(update["quest_code"] == quest["quest_code"] for update in first_payload["quest_updates"])

    second_track = client.post("/api/gamification/track", headers=headers, json=payload)
    assert second_track.status_code == 200
    second_payload = second_track.json()
    assert second_payload["accepted"] is False
    assert second_payload["blocked_reason"] == "DUPLICATE_TARGET"
    assert second_payload["exp_gained"] == 0
    assert second_payload["total_exp"] == first_payload["total_exp"]


def test_track_awards_all_clear_bonus_once(client, auth_headers) -> None:
    _, headers = auth_headers
    settings = get_settings()

    quests_response = client.get("/api/gamification/quests", headers=headers)
    assert quests_response.status_code == 200
    quests = quests_response.json()["quests"]

    all_clear_award_count = 0

    for index, quest in enumerate(quests):
        track_payload = {
            "action_type": quest["action_type"],
            "target_id": f"{quest['quest_code']}-all-clear-{index}",
            "value": int(quest["target_value"]),
        }
        track_response = client.post("/api/gamification/track", headers=headers, json=track_payload)
        assert track_response.status_code == 200
        track_result = track_response.json()
        if track_result["all_clear_awarded"]:
            all_clear_award_count += 1
            assert track_result["all_clear_bonus_exp"] == settings.daily_quest_all_clear_bonus_exp

    assert all_clear_award_count == 1

    refreshed_quests = client.get("/api/gamification/quests", headers=headers)
    assert refreshed_quests.status_code == 200
    refreshed_payload = refreshed_quests.json()
    assert refreshed_payload["all_clear_completed"] is True
    assert all(quest["is_completed"] for quest in refreshed_payload["quests"])
