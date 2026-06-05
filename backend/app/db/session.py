from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_mysql_tables():
    from app.db.base import Base
    from app.models.upload_models import MySQLDocument, MySQLDocumentHash, MySQLCacheHit, MySQLAIJob
    from app.models.fsrs_graph_models import (
        ConceptTag, ConceptEdge, ConceptWeakness, FSRSCard, FSRSReview, LessonTag, FlashcardTag
    )
    # Automatically generate upload schema and FSRS/KG schema for MySQL
    Base.metadata.create_all(bind=engine, tables=[
        MySQLDocument.__table__,
        MySQLDocumentHash.__table__,
        MySQLCacheHit.__table__,
        MySQLAIJob.__table__,
        ConceptTag.__table__,
        ConceptEdge.__table__,
        ConceptWeakness.__table__,
        FSRSCard.__table__,
        FSRSReview.__table__,
        LessonTag.__table__,
        FlashcardTag.__table__
    ])





