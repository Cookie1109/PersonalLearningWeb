from fastapi import APIRouter

from app.api.routes import auth_router, health_router, lessons_router, quizzes_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(health_router)
api_router.include_router(lessons_router)
api_router.include_router(quizzes_router)
