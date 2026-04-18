from .documents import router as documents_router
from .auth import router as auth_router
from .chat import router as chat_router
from .flashcards import router as flashcards_router
from .health import router as health_router
from .lessons import router as lessons_router
from .parser import router as parser_router
from .quizzes import router as quizzes_router

__all__ = [
	"documents_router",
	"auth_router",
	"chat_router",
	"flashcards_router",
	"health_router",
	"lessons_router",
	"parser_router",
	"quizzes_router",
]
