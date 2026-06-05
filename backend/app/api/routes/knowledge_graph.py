from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select, and_, func as sqlfunc
from pydantic import BaseModel
from typing import List
from datetime import datetime, timezone, timedelta

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.models.fsrs_graph_models import ConceptTag, ConceptEdge, ConceptWeakness

router = APIRouter(prefix="/knowledge-graph", tags=["knowledge-graph"])

# Only run full weakness sync if last update is older than this threshold
_SYNC_COOLDOWN = timedelta(minutes=5)


def _should_sync_weakness(db: Session, user_id: int) -> bool:
    """Returns True if a full weakness sync is needed (data is stale or missing)."""
    last_updated = db.scalar(
        select(sqlfunc.max(ConceptWeakness.last_updated))
        .where(ConceptWeakness.user_id == user_id)
    )
    if last_updated is None:
        return True
    # Ensure timezone-aware comparison
    now_utc = datetime.now(timezone.utc)
    last_updated_utc = last_updated if last_updated.tzinfo else last_updated.replace(tzinfo=timezone.utc)
    return (now_utc - last_updated_utc) > _SYNC_COOLDOWN


class GraphNodeDTO(BaseModel):
    id: int
    name: str
    weakness_score: float
    card_count: int


class GraphEdgeDTO(BaseModel):
    id: int
    source_tag_id: int
    target_tag_id: int
    weight: float
    relationship_type: str


class KnowledgeGraphResponseDTO(BaseModel):
    nodes: List[GraphNodeDTO]
    edges: List[GraphEdgeDTO]


class WeakConceptDTO(BaseModel):
    tag_id: int
    name: str
    weakness_score: float
    card_count: int


@router.get("", response_model=KnowledgeGraphResponseDTO)
def get_knowledge_graph(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> KnowledgeGraphResponseDTO:
    """
    Retrieve the entire Knowledge Graph (nodes and edges) for the current user.
    """
    # Sync weakness scores only when data is stale (self-healing on card deletions)
    from app.services.concept_aggregation import sync_concept_weakness_for_user
    if _should_sync_weakness(db, current_user.id):
        sync_concept_weakness_for_user(db, current_user.id)

    # 1. Fetch all tags for the user
    stmt_tags = select(ConceptTag).where(ConceptTag.user_id == current_user.id)
    tags = db.scalars(stmt_tags).all()

    # 2. Fetch weaknesses for these tags
    stmt_weakness = select(ConceptWeakness).where(ConceptWeakness.user_id == current_user.id)
    weaknesses = db.scalars(stmt_weakness).all()
    weakness_map = {w.tag_id: w for w in weaknesses}

    nodes = []
    for tag in tags:
        w_record = weakness_map.get(tag.id)
        score = w_record.weakness_score if w_record else 0.5
        count = w_record.card_count if w_record else 0
        nodes.append(GraphNodeDTO(
            id=tag.id,
            name=tag.name,
            weakness_score=score,
            card_count=count
        ))

    # 3. Fetch all edges for the user
    stmt_edges = select(ConceptEdge).where(ConceptEdge.user_id == current_user.id)
    edges = db.scalars(stmt_edges).all()

    edge_dtos = [
        GraphEdgeDTO(
            id=e.id,
            source_tag_id=e.source_tag_id,
            target_tag_id=e.target_tag_id,
            weight=e.weight,
            relationship_type=e.relationship_type
        )
        for e in edges
    ]

    return KnowledgeGraphResponseDTO(nodes=nodes, edges=edge_dtos)


@router.get("/weak-concepts", response_model=List[WeakConceptDTO])
def get_weak_concepts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> List[WeakConceptDTO]:
    """
    Retrieve list of concepts sorted by weakness score descending.
    Filters for weakness_score > 0.60.
    """
    # Sync weakness scores only when data is stale (cooldown: 5 minutes)
    from app.services.concept_aggregation import sync_concept_weakness_for_user
    if _should_sync_weakness(db, current_user.id):
        sync_concept_weakness_for_user(db, current_user.id)

    # Single join query instead of N+1 db.get() calls per weakness record
    stmt = (
        select(ConceptWeakness, ConceptTag)
        .join(ConceptTag, ConceptTag.id == ConceptWeakness.tag_id)
        .where(
            and_(
                ConceptWeakness.user_id == current_user.id,
                ConceptWeakness.weakness_score > 0.60
            )
        )
        .order_by(ConceptWeakness.weakness_score.desc())
    )
    rows = db.execute(stmt).all()

    return [
        WeakConceptDTO(
            tag_id=weakness.tag_id,
            name=tag.name,
            weakness_score=weakness.weakness_score,
            card_count=weakness.card_count
        )
        for weakness, tag in rows
    ]
