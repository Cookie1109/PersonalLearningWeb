from redis import Redis

from app.core.config import get_settings

_settings = get_settings()
_redis_client = Redis.from_url(_settings.redis_url, decode_responses=True)


def get_redis_client() -> Redis:
    return _redis_client
