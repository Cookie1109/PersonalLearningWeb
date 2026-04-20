from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.infra.firebase_client import init_firebase_app

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    init_firebase_app(strict=False)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(RequestContextMiddleware)

    cors_allow_origins = settings.cors_allow_origins or []
    allow_all_origins = "*" in cors_allow_origins
    cors_allow_credentials = settings.cors_allow_credentials and not allow_all_origins

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if allow_all_origins else cors_allow_origins,
        allow_origin_regex=None if allow_all_origins else settings.cors_allow_origin_regex,
        allow_credentials=cors_allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
