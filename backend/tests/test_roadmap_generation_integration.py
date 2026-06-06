from __future__ import annotations

import json
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Lesson, Roadmap
from app.models.fsrs_graph_models import ConceptTag
import app.services.roadmap_generation_service as roadmap_service


def test_generate_roadmap_success_and_stores_lessons_with_user_id(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers

    # Mock request_roadmap_from_llm to return a valid JSON array
    mock_response = json.dumps([
        {
            "week": 1,
            "title": "Tuan 1: Co ban",
            "lessons": [
                {"title": "Bai 1: Bien va kieu du lieu", "concept_tags": ["variables", "datatypes"]},
                {"title": "Bai 2: Cau truc dieu khien", "concept_tags": ["loops"]}
            ]
        },
        {
            "week": 2,
            "title": "Tuan 2: Nang cao",
            "lessons": [
                {"title": "Bai 3: Ham va Module", "concept_tags": ["functions", "variables"]}
            ]
        }
    ])
    monkeypatch.setattr(roadmap_service, "request_roadmap_from_llm", lambda prompt: mock_response)

    response = client.post(
        "/api/roadmaps/generate",
        json={"goal": "Hoc Python tu con so khong"},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert "weeks" in payload
    assert len(payload["weeks"]) == 2

    # Verify Roadmap is stored in DB
    db_session.expire_all()
    roadmap = db_session.scalar(
        select(Roadmap).where(Roadmap.user_id == user.id, Roadmap.is_active.is_(True))
    )
    assert roadmap is not None
    assert roadmap.goal == "Hoc Python tu con so khong"

    # Verify Lessons are stored in DB AND contain the correct user_id (the bug fix verification!)
    # Week 1 has 2 lessons. Week 2 has 1 lesson, which gets padded to 3 lessons. Total = 5 lessons.
    lessons = list(db_session.scalars(
        select(Lesson).where(Lesson.roadmap_id == roadmap.id).order_by(Lesson.week_number, Lesson.position)
    ))
    assert len(lessons) == 5
    for lesson in lessons:
        assert lesson.user_id == user.id  # Verifies the critical fix!
        assert lesson.roadmap_id == roadmap.id

    # Verify ConceptTags are created and reused correctly
    tags = list(db_session.scalars(select(ConceptTag).where(ConceptTag.user_id == user.id)))
    # Tag names should be variables, datatypes, loops, functions (4 unique tags)
    tag_names = {t.name for t in tags}
    assert tag_names == {"variables", "datatypes", "loops", "functions"}


def test_generate_roadmap_parser_robustness_and_auto_repair(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers

    # Case 1: LLM returns a dictionary wrapping the array, and string week numbers like "Week 1"
    mock_wrapped_response = json.dumps({
        "roadmap": [
            {
                "week": "Week 1",
                "title": "Tuan 1",
                "lessons": [
                    {"title": "Bai 1", "concept_tags": ["arrays"]}
                ]
            }
        ]
    })
    
    # Text also contains some markdown prose outside fences
    llm_prose_response = f"Sure, here is your plan:\n{mock_wrapped_response}\nHope this helps!"
    monkeypatch.setattr(roadmap_service, "request_roadmap_from_llm", lambda prompt: llm_prose_response)

    response = client.post(
        "/api/roadmaps/generate",
        json={"goal": "Hoc cau truc du lieu"},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["weeks"]) == 1
    assert payload["weeks"][0]["week_number"] == 1

    # Verify week 1 is parsed correctly and Lesson has the correct user_id
    db_session.expire_all()
    roadmap = db_session.scalar(
        select(Roadmap).where(Roadmap.user_id == user.id, Roadmap.is_active.is_(True))
    )
    assert roadmap is not None
    
    # Week 1 has 1 lesson, which gets padded to 3 lessons.
    lessons = list(db_session.scalars(select(Lesson).where(Lesson.roadmap_id == roadmap.id)))
    assert len(lessons) == 3
    
    bai_1_lesson = next(l for l in lessons if l.title == "Bai 1")
    assert bai_1_lesson.user_id == user.id


def test_generate_roadmap_with_duplicate_tags_handling(
    client,
    db_session: Session,
    auth_headers,
    monkeypatch,
) -> None:
    user, headers = auth_headers

    # LLM returns duplicate tags in the same lesson (both exact duplicates and casing variations)
    mock_response = json.dumps([
        {
            "week": 1,
            "title": "Tuan 1: Co ban",
            "lessons": [
                {"title": "Bai 1", "concept_tags": ["Variables", "variables", "VARIABLES", "other"]}
            ]
        }
    ])
    monkeypatch.setattr(roadmap_service, "request_roadmap_from_llm", lambda prompt: mock_response)

    response = client.post(
        "/api/roadmaps/generate",
        json={"goal": "Hoc Python"},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["weeks"]) == 1

