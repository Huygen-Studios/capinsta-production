from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import psycopg


class QuotaExceededError(RuntimeError):
    pass


def _limit(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _limit_with_legacy(name: str, legacy_name: str, default: int) -> int:
    if os.getenv(name) is not None:
        return _limit(name, default)
    return _limit(legacy_name, default)


def enabled() -> bool:
    return (os.getenv("ENABLE_USAGE_QUOTAS") or "false").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _is_override(user_id: str) -> bool:
    return user_id in {
        value.strip()
        for value in os.getenv("PRIVATE_BETA_ADMIN_USER_IDS", "").split(",")
        if value.strip()
    }


async def reserve_candidate_regeneration(
    *, user_id: str, project_id: str, idempotency_key: str
) -> None:
    if not enabled():
        return
    database_url = (
        os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or ""
    ).strip()
    async with await psycopg.AsyncConnection.connect(
        database_url, connect_timeout=5
    ) as connection:
        async with connection.transaction():
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                    (user_id,),
                )
                await cursor.execute(
                    "SELECT status FROM usage_reservations WHERE idempotency_key=%s",
                    (idempotency_key,),
                )
                if await cursor.fetchone():
                    return
                await cursor.execute(
                    """
                    SELECT COALESCE((SELECT (value #>> '{}')::integer
                      FROM system_settings
                      WHERE key='beta_candidate_regenerations'),5)
                    """
                )
                limit = int((await cursor.fetchone())[0])
                await cursor.execute(
                    """
                    SELECT count(*) FROM usage_reservations
                    WHERE user_id=%s::uuid AND resource_id=%s
                      AND metric='candidate_regeneration'
                      AND period_start=CURRENT_DATE
                      AND status IN ('reserved','committed')
                    """,
                    (user_id, project_id),
                )
                used = int((await cursor.fetchone())[0])
                if used >= limit:
                    raise QuotaExceededError("candidate_regeneration_quota_exceeded")
                await cursor.execute(
                    """
                    INSERT INTO usage_reservations (
                      idempotency_key,user_id,resource_type,resource_id,metric,
                      quantity,unit,status,expires_at
                    ) VALUES (%s,%s::uuid,'clip_project',%s,
                      'candidate_regeneration',1,'count','reserved',%s)
                    """,
                    (
                        idempotency_key,
                        user_id,
                        project_id,
                        datetime.now(timezone.utc) + timedelta(minutes=15),
                    ),
                )


def project_reservation_key(idempotency_key: str) -> str:
    return f"clip-project:{idempotency_key}"


def export_reservation_key(idempotency_key: str) -> str:
    return f"clip-export:{idempotency_key}"


async def reserve_project_admission(
    *, user_id: str, media_asset_id: str, idempotency_key: str
) -> str | None:
    """Reserve the small, server-owned private-beta processing budget."""
    if not enabled():
        return None
    if _is_override(user_id):
        return None
    database_url = (os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()
    reservation_key = project_reservation_key(idempotency_key)
    async with await psycopg.AsyncConnection.connect(database_url, connect_timeout=5) as connection:
        async with connection.transaction():
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (user_id,))
                await cursor.execute("SELECT 1 FROM usage_reservations WHERE idempotency_key=%s", (reservation_key,))
                if await cursor.fetchone():
                    return reservation_key
                await cursor.execute(
                    """SELECT COALESCE(size_bytes,0),COALESCE(duration_ms,0) FROM media_assets
                    WHERE id=%s::uuid AND owner_user_id=%s::uuid AND deleted_at IS NULL""",
                    (media_asset_id, user_id),
                )
                asset = await cursor.fetchone()
                if not asset:
                    raise QuotaExceededError("source_media_not_found")
                size_bytes, duration_ms = map(int, asset)
                if size_bytes > _limit_with_legacy(
                    "MAX_SOURCE_FILE_BYTES",
                    "PRIVATE_BETA_MAX_SOURCE_FILE_BYTES",
                    _limit("MEDIA_UPLOAD_MAX_BYTES", 2_147_483_648),
                ):
                    raise QuotaExceededError("source_file_size_limit_exceeded")
                if duration_ms > _limit_with_legacy(
                    "MAX_SOURCE_DURATION_SECONDS",
                    "PRIVATE_BETA_MAX_SOURCE_DURATION_SECONDS",
                    _limit("MAX_MEDIA_DURATION_SECONDS", 5_400),
                ) * 1000:
                    raise QuotaExceededError("source_duration_limit_exceeded")
                await cursor.execute(
                    """SELECT count(*) FROM processing_jobs WHERE owner_user_id=%s::uuid
                    AND status IN ('queued','claimed','running','retry_wait','cancel_requested')""",
                    (user_id,),
                )
                if int((await cursor.fetchone())[0]) >= _limit_with_legacy(
                    "MAX_ACTIVE_PROCESSING_JOBS_PER_USER",
                    "PRIVATE_BETA_MAX_ACTIVE_PROCESSING_JOBS",
                    2,
                ):
                    raise QuotaExceededError("concurrent_processing_limit_exceeded")
                await cursor.execute(
                    """SELECT COALESCE(sum(size_bytes),0) FROM media_assets WHERE owner_user_id=%s::uuid
                    AND deleted_at IS NULL""",
                    (user_id,),
                )
                if int((await cursor.fetchone())[0]) > _limit_with_legacy(
                    "MAX_STORED_SOURCE_BYTES",
                    "PRIVATE_BETA_MAX_STORED_SOURCE_BYTES",
                    10_737_418_240,
                ):
                    raise QuotaExceededError("stored_source_bytes_limit_exceeded")
                minutes = duration_ms / 60_000
                await cursor.execute(
                    """SELECT COALESCE(sum(quantity),0) FROM usage_reservations WHERE user_id=%s::uuid
                    AND metric='clipper_processing_minutes' AND period_start=CURRENT_DATE
                    AND status IN ('reserved','committed')""",
                    (user_id,),
                )
                if float((await cursor.fetchone())[0]) + minutes > _limit_with_legacy(
                    "MAX_PROCESSING_MINUTES_PER_PERIOD",
                    "PRIVATE_BETA_PROCESSING_MINUTES",
                    180,
                ):
                    raise QuotaExceededError("processing_minutes_limit_exceeded")
                await cursor.execute(
                    """INSERT INTO usage_reservations(idempotency_key,user_id,resource_type,resource_id,metric,
                    quantity,unit,status,expires_at) VALUES(%s,%s::uuid,'media_asset',%s,
                    'clipper_processing_minutes',%s,'minutes','reserved',%s)""",
                    (reservation_key, user_id, media_asset_id, minutes, datetime.now(timezone.utc) + timedelta(hours=2)),
                )
    return reservation_key


async def reserve_export_admission(*, user_id: str, project_id: str, idempotency_key: str) -> str | None:
    if not enabled():
        return None
    if _is_override(user_id):
        return None
    database_url = (os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()
    reservation_key = export_reservation_key(idempotency_key)
    async with await psycopg.AsyncConnection.connect(database_url, connect_timeout=5) as connection:
        async with connection.transaction():
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (user_id,))
                await cursor.execute("SELECT 1 FROM usage_reservations WHERE idempotency_key=%s", (reservation_key,))
                if await cursor.fetchone():
                    return reservation_key
                await cursor.execute(
                    """SELECT count(*) FROM processing_jobs WHERE owner_user_id=%s::uuid AND job_type='clip_export'
                    AND status IN ('queued','claimed','running','retry_wait','cancel_requested')""",
                    (user_id,),
                )
                if int((await cursor.fetchone())[0]) >= _limit("PRIVATE_BETA_MAX_CONCURRENT_EXPORTS", 1):
                    raise QuotaExceededError("concurrent_export_limit_exceeded")
                await cursor.execute(
                    """SELECT COALESCE(sum(size_bytes),0) FROM clipping_exports WHERE owner_user_id=%s::uuid
                    AND deleted_at IS NULL""",
                    (user_id,),
                )
                if int((await cursor.fetchone())[0]) >= _limit_with_legacy(
                    "MAX_STORED_EXPORT_BYTES",
                    "PRIVATE_BETA_MAX_STORED_EXPORT_BYTES",
                    10_737_418_240,
                ):
                    raise QuotaExceededError("stored_export_bytes_limit_exceeded")
                await cursor.execute(
                    """INSERT INTO usage_reservations(idempotency_key,user_id,resource_type,resource_id,metric,
                    quantity,unit,status,expires_at) VALUES(%s,%s::uuid,'clip_project',%s,
                    'clipper_export',1,'count','reserved',%s)""",
                    (reservation_key, user_id, project_id, datetime.now(timezone.utc) + timedelta(hours=2)),
                )
    return reservation_key


async def finish_reservation(idempotency_key: str, *, committed: bool) -> None:
    if not enabled():
        return
    database_url = (
        os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or ""
    ).strip()
    async with await psycopg.AsyncConnection.connect(
        database_url, connect_timeout=5
    ) as connection:
        await connection.execute(
            """
            UPDATE usage_reservations SET status=%s,final_quantity=%s,updated_at=now()
            WHERE idempotency_key=%s AND status='reserved'
            """,
            ("committed" if committed else "released", 1 if committed else 0, idempotency_key),
        )
        await connection.commit()
