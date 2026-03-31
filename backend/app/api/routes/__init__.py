from .auth import router as auth_router
from .health import router as health_router
from .lessons import router as lessons_router
from .quizzes import router as quizzes_router
from .roadmaps import router as roadmaps_router

__all__ = ["auth_router", "health_router", "lessons_router", "quizzes_router", "roadmaps_router"]
