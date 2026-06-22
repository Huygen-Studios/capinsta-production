import asyncio
import os
from dataclasses import dataclass

import aiosqlite
from fastapi import HTTPException

from .settings import DB_PATH

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None


@dataclass(frozen=True)
class UserLimits:
    daily_caption_minutes: int = 60
    daily_export_minutes: int = 60
    max_upload_duration_seconds: int = 1800
    max_concurrent_caption_jobs: int = 2
    max_concurrent_export_jobs: int = 1


def database_url() -> str:
    return (os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()


def _allow_without_control_plane() -> bool:
    return os.getenv("NODE_ENV", "development") != "production"


async def _query_one(query: str, params: tuple = ()):
    url = database_url()
    if not url or psycopg is None:
        if _allow_without_control_plane():
            return None
        raise HTTPException(status_code=503, detail="Control plane unavailable")
    try:
        async with await psycopg.AsyncConnection.connect(url, connect_timeout=3) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(query, params)
                return await cursor.fetchone()
    except HTTPException:
        raise
    except Exception as exc:
        if _allow_without_control_plane():
            return None
        raise HTTPException(status_code=503, detail="Control plane unavailable") from exc


async def require_active_account(user_id: str) -> None:
    row = await _query_one(
        "SELECT account_status FROM profiles WHERE user_id = %s::uuid",
        (user_id,),
    )
    if row is not None and row[0] != "active":
        raise HTTPException(status_code=403, detail="Account unavailable")


async def feature_enabled(key: str, default: bool = True) -> bool:
    row = await _query_one("SELECT enabled FROM feature_flags WHERE key = %s", (key,))
    return default if row is None else bool(row[0])


async def system_int(key: str, default: int, minimum: int, maximum: int) -> int:
    row = await _query_one("SELECT value FROM system_settings WHERE key = %s", (key,))
    if row is None:
        return default
    try:
        value = int(row[0])
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


async def require_feature(key: str, message: str) -> None:
    if not await feature_enabled(key):
        raise HTTPException(status_code=503, detail=message)
    if key != "maintenance_mode" and await feature_enabled("maintenance_mode", False):
        raise HTTPException(status_code=503, detail="Capinsta is temporarily in maintenance mode.")


async def require_provider_enabled(provider: str) -> None:
    if provider in {"", "auto"}:
        return
    row = await _query_one(
        "SELECT COALESCE((configuration ->> %s)::boolean, true) FROM feature_flags WHERE key = 'provider_controls'",
        (provider,),
    )
    if row is not None and not bool(row[0]):
        raise HTTPException(status_code=503, detail="The configured transcription provider is temporarily unavailable.")


async def user_limits(user_id: str) -> UserLimits:
    row = await _query_one(
        """
        SELECT daily_caption_minutes, daily_export_minutes,
               max_upload_duration_seconds, max_concurrent_caption_jobs,
               max_concurrent_export_jobs
        FROM user_quotas WHERE user_id = %s::uuid
        """,
        (user_id,),
    )
    if row is not None:
        return UserLimits(*map(int, row))
    defaults = await asyncio.gather(
        system_int("daily_caption_minutes", 60, 0, 100000),
        system_int("daily_export_minutes", 60, 0, 100000),
        system_int("maximum_upload_duration_seconds", 1800, 1, 86400),
        system_int("maximum_concurrent_caption_jobs", 2, 1, 100),
        system_int("maximum_concurrent_export_jobs", 1, 1, 100),
    )
    return UserLimits(*defaults)


async def _daily_usage(user_id: str, metric: str) -> float:
    row = await _query_one(
        """
        SELECT COALESCE(sum(numeric_value), 0)
        FROM usage_events
        WHERE user_id = %s::uuid
          AND event_type = %s
          AND occurred_at >= CURRENT_DATE
          AND occurred_at < CURRENT_DATE + INTERVAL '1 day'
        """,
        (user_id, metric),
    )
    return 0.0 if row is None else float(row[0] or 0)


async def enforce_caption_quota(user_id: str, requested_seconds: float | None = None) -> UserLimits:
    limits = await user_limits(user_id)
    if requested_seconds and requested_seconds > limits.max_upload_duration_seconds:
        raise HTTPException(status_code=413, detail="Media duration exceeds your current limit.")
    used = await _daily_usage(user_id, "caption_minutes")
    requested_minutes = max(0.0, float(requested_seconds or 0) / 60)
    if used + requested_minutes > limits.daily_caption_minutes:
        raise HTTPException(status_code=429, detail="Daily caption quota reached.")
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "SELECT count(*) FROM jobs WHERE user_id = ? AND status NOT IN ('completed','failed','cancelled','expired','closed')",
            (user_id,),
        )
        active = int((await cursor.fetchone())[0])
    if active >= limits.max_concurrent_caption_jobs:
        raise HTTPException(status_code=429, detail="Concurrent caption-job limit reached.")
    return limits


async def enforce_export_quota(user_id: str, requested_seconds: float) -> UserLimits:
    limits = await user_limits(user_id)
    used = await _daily_usage(user_id, "export_minutes")
    if used + max(0.0, requested_seconds / 60) > limits.daily_export_minutes:
        raise HTTPException(status_code=429, detail="Daily export quota reached.")
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "SELECT count(*) FROM export_jobs WHERE user_id = ? AND status IN ('queued','running')",
            (user_id,),
        )
        active = int((await cursor.fetchone())[0])
    if active >= limits.max_concurrent_export_jobs:
        raise HTTPException(status_code=429, detail="Concurrent export-job limit reached.")
    global_limit = await system_int("global_export_concurrency", 1, 1, 1000)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "SELECT count(*) FROM export_jobs WHERE status IN ('queued','running')"
        )
        globally_active = int((await cursor.fetchone())[0])
    if globally_active >= global_limit:
        raise HTTPException(status_code=429, detail="Global export capacity is currently full.")
    return limits


async def project_retention_state(project_id: str) -> tuple[bool, str | None]:
    row = await _query_one(
        "SELECT retention_hold, expires_at::text FROM project_registry WHERE project_id = %s",
        (project_id,),
    )
    return (False, None) if row is None else (bool(row[0]), row[1])
