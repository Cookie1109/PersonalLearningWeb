from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.core.config import get_settings
from app.models import ExpLedger
from app.services.daily_quest_service import resolve_daily_quest_date, track_gamification_action


def _insert_exp_ledger_entry(
    *,
    db_session,
    user_id: int,
    exp_amount: int,
    awarded_at: datetime,
    target_id: str,
) -> None:
    db_session.add(
        ExpLedger(
            user_id=user_id,
            lesson_id=None,
            quiz_id=None,
            action_type="READ_DOCUMENT",
            target_id=target_id,
            reward_type="gamification_track",
            exp_amount=exp_amount,
            metadata_json={"source": "test_heatmap"},
            awarded_at=awarded_at,
        )
    )


def _local_to_utc(*, year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    timezone = ZoneInfo("Asia/Ho_Chi_Minh")
    return datetime(year, month, day, hour, minute, tzinfo=timezone).astimezone(UTC)


def test_gamification_profile_returns_progressive_level_snapshot(client, auth_headers, db_session) -> None:
    user, headers = auth_headers
    today_local = resolve_daily_quest_date()

    user.exp = 4500
    user.total_exp = 4500
    user.level = 99
    user.current_streak = 2
    user.streak = 2
    user.last_study_date = today_local
    db_session.commit()

    response = client.get("/api/gamification/profile", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["level"] == 3
    assert payload["current_exp"] == 1500
    assert payload["target_exp"] == 3000
    assert payload["total_exp"] == 4500
    assert payload["current_streak"] == 2
    assert payload["display_streak"] == 2
    assert payload["streak_status"] == "ACTIVE"


def test_gamification_profile_returns_pending_streak_display(client, auth_headers, db_session) -> None:
    user, headers = auth_headers
    today_local = resolve_daily_quest_date()

    user.current_streak = 7
    user.streak = 7
    user.last_study_date = today_local - timedelta(days=1)
    db_session.commit()

    response = client.get("/api/gamification/profile", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["current_streak"] == 7
    assert payload["display_streak"] == 7
    assert payload["streak_status"] == "PENDING"


def test_gamification_profile_returns_lost_streak_display(client, auth_headers, db_session) -> None:
    user, headers = auth_headers
    today_local = resolve_daily_quest_date()

    user.current_streak = 7
    user.streak = 7
    user.last_study_date = today_local - timedelta(days=3)
    db_session.commit()

    response = client.get("/api/gamification/profile", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["current_streak"] == 7
    assert payload["display_streak"] == 0
    assert payload["streak_status"] == "LOST"


def test_daily_quests_auto_generate_two_fixed_quests(client, auth_headers) -> None:
    _, headers = auth_headers

    response = client.get("/api/gamification/quests", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    quests = payload["quests"]

    assert len(quests) == 2
    assert {quest["quest_code"] for quest in quests} == {"READ_5M", "COMPLETE_QUIZ"}
    assert {quest["action_type"] for quest in quests} == {"READ_DOCUMENT", "QUIZ_COMPLETED"}
    assert payload["all_clear_completed"] is False


def test_track_updates_progress_and_rejects_duplicate_target(client, auth_headers) -> None:
    _, headers = auth_headers

    quests_response = client.get("/api/gamification/quests", headers=headers)
    assert quests_response.status_code == 200
    quest = next(
        (item for item in quests_response.json()["quests"] if item["action_type"] != "READ_DOCUMENT"),
        None,
    )
    assert quest is not None

    payload = {
        "action_type": quest["action_type"],
        "target_id": f"{quest['quest_code']}-unit-target",
        "value": int(quest["target_value"]),
    }

    first_track = client.post("/api/gamification/track", headers=headers, json=payload)
    assert first_track.status_code == 200
    first_payload = first_track.json()
    assert first_payload["accepted"] is True
    assert first_payload["exp_gained"] >= 0
    assert any(update["quest_code"] == quest["quest_code"] for update in first_payload["quest_updates"])

    second_track = client.post("/api/gamification/track", headers=headers, json=payload)
    assert second_track.status_code == 200
    second_payload = second_track.json()
    assert second_payload["accepted"] is False
    assert second_payload["blocked_reason"] == "DUPLICATE_TARGET"
    assert second_payload["exp_gained"] == 0
    assert second_payload["total_exp"] == first_payload["total_exp"]


def test_track_read_document_allows_same_target_and_accumulates_progress(client, auth_headers) -> None:
    _, headers = auth_headers

    quests_response = client.get("/api/gamification/quests", headers=headers)
    assert quests_response.status_code == 200
    reading_quest = next(
        (item for item in quests_response.json()["quests"] if item["action_type"] == "READ_DOCUMENT"),
        None,
    )
    assert reading_quest is not None

    payload = {
        "action_type": "READ_DOCUMENT",
        "target_id": "same-document-id",
        "value": 1,
    }

    last_payload = None
    for _ in range(3):
        track_response = client.post("/api/gamification/track", headers=headers, json=payload)
        assert track_response.status_code == 200
        track_payload = track_response.json()
        assert track_payload["accepted"] is True
        assert track_payload["blocked_reason"] is None

        quest_update = next(
            (update for update in track_payload["quest_updates"] if update["quest_code"] == reading_quest["quest_code"]),
            None,
        )
        assert quest_update is not None
        last_payload = track_payload

    assert last_payload is not None
    last_update = next(
        update for update in last_payload["quest_updates"] if update["quest_code"] == reading_quest["quest_code"]
    )
    assert last_update["current_progress"] == 3

    refreshed_quests = client.get("/api/gamification/quests", headers=headers)
    assert refreshed_quests.status_code == 200
    refreshed_reading_quest = next(
        (item for item in refreshed_quests.json()["quests"] if item["action_type"] == "READ_DOCUMENT"),
        None,
    )
    assert refreshed_reading_quest is not None
    assert refreshed_reading_quest["current_progress"] == 3


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


def test_streak_increases_after_first_daily_quest_completed(client, auth_headers, db_session) -> None:
    user, headers = auth_headers

    user.current_streak = 2
    user.streak = 2
    user.last_study_date = datetime.now(UTC).date() - timedelta(days=1)
    db_session.commit()

    quests_response = client.get("/api/gamification/quests", headers=headers)
    assert quests_response.status_code == 200
    quests = quests_response.json()["quests"]

    first_quest = quests[0]
    first_track = client.post(
        "/api/gamification/track",
        headers=headers,
        json={
            "action_type": first_quest["action_type"],
            "target_id": f"{first_quest['quest_code']}-streak-first",
            "value": int(first_quest["target_value"]),
        },
    )
    assert first_track.status_code == 200
    first_payload = first_track.json()
    assert first_payload["current_streak"] == 3

    second_quest = quests[1]
    second_track = client.post(
        "/api/gamification/track",
        headers=headers,
        json={
            "action_type": second_quest["action_type"],
            "target_id": f"{second_quest['quest_code']}-streak-second",
            "value": int(second_quest["target_value"]),
        },
    )
    assert second_track.status_code == 200
    second_payload = second_track.json()
    assert second_payload["current_streak"] == 3


def test_track_streak_only_increases_once_within_same_local_day(db_session, auth_headers) -> None:
    user, _ = auth_headers

    user.current_streak = 2
    user.streak = 2
    user.last_study_date = date(2026, 4, 19)
    db_session.commit()

    timezone = ZoneInfo("Asia/Ho_Chi_Minh")
    first_now_utc = datetime(2026, 4, 20, 0, 30, tzinfo=timezone).astimezone(UTC)
    second_now_utc = datetime(2026, 4, 20, 8, 15, tzinfo=timezone).astimezone(UTC)

    first_result = track_gamification_action(
        db=db_session,
        user_id=user.id,
        action_type="READ_DOCUMENT",
        target_id="same-local-day-read-1",
        value=5,
        now_utc=first_now_utc,
    )
    assert first_result.current_streak == 3

    second_result = track_gamification_action(
        db=db_session,
        user_id=user.id,
        action_type="READ_DOCUMENT",
        target_id="same-local-day-read-2",
        value=1,
        now_utc=second_now_utc,
    )
    assert second_result.current_streak == 3


def test_heatmap_returns_empty_data_when_user_has_no_exp_entries(client, auth_headers) -> None:
    _, headers = auth_headers
    target_year = datetime.now(UTC).astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).year

    response = client.get(f"/api/gamification/heatmap?year={target_year}", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload == {"data": {}}


def test_heatmap_requires_year_query_param(client, auth_headers) -> None:
    _, headers = auth_headers

    response = client.get("/api/gamification/heatmap", headers=headers)

    assert response.status_code == 422


def test_heatmap_aggregates_total_exp_per_local_day(client, auth_headers, db_session) -> None:
    user, headers = auth_headers
    target_year = datetime.now(UTC).astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).year

    first_entry = _local_to_utc(year=target_year, month=4, day=18, hour=9)
    second_entry = _local_to_utc(year=target_year, month=4, day=18, hour=20, minute=15)

    _insert_exp_ledger_entry(
        db_session=db_session,
        user_id=user.id,
        exp_amount=120,
        awarded_at=first_entry,
        target_id="heatmap-aggregate-a",
    )
    _insert_exp_ledger_entry(
        db_session=db_session,
        user_id=user.id,
        exp_amount=210,
        awarded_at=second_entry,
        target_id="heatmap-aggregate-b",
    )
    db_session.commit()

    response = client.get(f"/api/gamification/heatmap?year={target_year}", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    expected_key = f"{target_year}-04-18"
    assert payload["data"].get(expected_key) == 330


def test_heatmap_groups_entries_by_utc_plus_7_day_boundary(client, auth_headers, db_session) -> None:
    user, headers = auth_headers
    target_year = datetime.now(UTC).astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).year

    before_midnight_local = _local_to_utc(year=target_year, month=6, day=1, hour=23, minute=30)
    after_midnight_local = _local_to_utc(year=target_year, month=6, day=2, hour=0, minute=10)

    _insert_exp_ledger_entry(
        db_session=db_session,
        user_id=user.id,
        exp_amount=50,
        awarded_at=before_midnight_local,
        target_id="heatmap-boundary-a",
    )
    _insert_exp_ledger_entry(
        db_session=db_session,
        user_id=user.id,
        exp_amount=70,
        awarded_at=after_midnight_local,
        target_id="heatmap-boundary-b",
    )
    db_session.commit()

    response = client.get(f"/api/gamification/heatmap?year={target_year}", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    first_key = f"{target_year}-06-01"
    second_key = f"{target_year}-06-02"
    assert payload["data"].get(first_key) == 50
    assert payload["data"].get(second_key) == 70


def test_heatmap_filters_records_outside_requested_year(client, auth_headers, db_session) -> None:
    user, headers = auth_headers
    target_year = datetime.now(UTC).astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).year

    in_year_entry = _local_to_utc(year=target_year, month=7, day=10, hour=10)
    previous_year_entry = _local_to_utc(year=target_year - 1, month=12, day=31, hour=12)
    next_year_entry = _local_to_utc(year=target_year + 1, month=1, day=1, hour=12)

    _insert_exp_ledger_entry(
        db_session=db_session,
        user_id=user.id,
        exp_amount=95,
        awarded_at=in_year_entry,
        target_id="heatmap-year-current",
    )
    _insert_exp_ledger_entry(
        db_session=db_session,
        user_id=user.id,
        exp_amount=777,
        awarded_at=previous_year_entry,
        target_id="heatmap-year-prev",
    )
    _insert_exp_ledger_entry(
        db_session=db_session,
        user_id=user.id,
        exp_amount=888,
        awarded_at=next_year_entry,
        target_id="heatmap-year-next",
    )
    db_session.commit()

    response = client.get(f"/api/gamification/heatmap?year={target_year}", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    in_year_key = f"{target_year}-07-10"
    previous_year_key = f"{target_year - 1}-12-31"
    next_year_key = f"{target_year + 1}-01-01"
    assert payload["data"].get(in_year_key) == 95
    assert previous_year_key not in payload["data"]
    assert next_year_key not in payload["data"]
