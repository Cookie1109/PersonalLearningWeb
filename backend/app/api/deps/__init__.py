from app.api.deps.auth import get_current_user
from app.api.deps.flashcards import get_owned_flashcard_or_404

__all__ = ["get_current_user", "get_owned_flashcard_or_404"]
