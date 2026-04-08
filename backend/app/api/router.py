from fastapi import APIRouter

from app.api.routes import auth_router, chat_router, documents_router, health_router, lessons_router, parser_router, quizzes_router

api_router = APIRouter()
api_router.include_router(documents_router)
api_router.include_router(auth_router)
api_router.include_router(chat_router)
api_router.include_router(health_router)
api_router.include_router(lessons_router)
api_router.include_router(parser_router)
api_router.include_router(quizzes_router)
