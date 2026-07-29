from __future__ import annotations

import argparse
import asyncio
import logging
import os
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg

from ..clipping_storage.config import MediaStorageConfig
from ..clipping_storage.errors import StorageError
from ..clipping_storage.provider import media_storage_for_provider

logger = logging.getLogger(__name__)

ACTIVE_JOB_STATUSES = ("queued", "claimed", "running", "retry_wait", "cancel_requested")


def _days(name: str, default: int) -> int:
    return max(1, int(os.getenv(name, str(default))))


def _hours(name: str, default: int) -> int:
    return max(1, int(os.getenv(name, str(default))))


async def _delete(storage, bucket: str, path: str) -> bool:
    try:
        await storage.delete_object(bucket=bucket, path=path)
    except StorageError as exc:
        if exc.category != "object_not_found":
            logger.warning("retention_storage_delete_failed category=%s", exc.category)
            return False
    return True


async def _expire_source(connection, asset_id: str, cutoff: datetime, config) -> bool:
    async with connection.transaction():
        async with connection.cursor() as cursor:
            await cursor.execute(
                """SELECT m.storage_provider,m.storage_bucket,m.storage_path FROM media_assets m
                WHERE m.id=%s::uuid AND m.deleted_at IS NULL AND m.updated_at < %s
                  AND m.storage_bucket IS NOT NULL AND m.storage_path IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM clip_projects p WHERE p.source_media_asset_id=m.id
                    AND p.deleted_at IS NULL AND p.archived_at IS NULL)
                  AND NOT EXISTS (SELECT 1 FROM processing_jobs j WHERE j.media_asset_id=m.id
                    AND j.status=ANY(%s)) FOR UPDATE SKIP LOCKED""",
                (asset_id, cutoff, ACTIVE_JOB_STATUSES),
            )
            row = await cursor.fetchone()
            if row is None:
                return False
            storage = media_storage_for_provider(row[0], config)
            if not await _delete(storage, str(row[1]), str(row[2])):
                return False
            await cursor.execute(
                """SELECT storage_provider,storage_bucket,storage_path FROM media_variants
                WHERE media_asset_id=%s::uuid AND storage_bucket IS NOT NULL AND storage_path IS NOT NULL""",
                (asset_id,),
            )
            for variant in await cursor.fetchall():
                variant_storage = media_storage_for_provider(variant[0], config)
                if not await _delete(variant_storage, str(variant[1]), str(variant[2])):
                    return False
            await cursor.execute(
                "UPDATE media_assets SET deleted_at=now(),updated_at=now() WHERE id=%s::uuid",
                (asset_id,),
            )
            return cursor.rowcount == 1


async def _expire_export(connection, export_id: str, cutoff: datetime, config) -> bool:
    async with connection.transaction():
        async with connection.cursor() as cursor:
            await cursor.execute(
                """SELECT e.storage_provider,e.storage_bucket,e.storage_path FROM clipping_exports e
                WHERE e.id=%s::uuid AND e.status='ready' AND e.ready_at < %s
                  AND e.storage_bucket IS NOT NULL AND e.storage_path IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM processing_jobs j WHERE j.id=e.processing_job_id
                    AND j.status=ANY(%s)) FOR UPDATE SKIP LOCKED""",
                (export_id, cutoff, ACTIVE_JOB_STATUSES),
            )
            row = await cursor.fetchone()
            if row is None:
                return False
            storage = media_storage_for_provider(row[0], config)
            if not await _delete(storage, str(row[1]), str(row[2])):
                return False
            await cursor.execute(
                """UPDATE clipping_exports SET status='deleted',ready_at=NULL,updated_at=now()
                WHERE id=%s::uuid AND status='ready'""",
                (export_id,),
            )
            return cursor.rowcount == 1


async def _expire_upload(connection, session_id: str, config) -> bool:
    async with connection.transaction():
        async with connection.cursor() as cursor:
            await cursor.execute(
                """SELECT storage_provider,storage_bucket,storage_path FROM media_upload_sessions
                WHERE id=%s::uuid AND expires_at < now()
                  AND status NOT IN ('completed','failed','expired','cancelled')
                FOR UPDATE SKIP LOCKED""",
                (session_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                return False
            storage = media_storage_for_provider(row[0], config)
            if not await _delete(storage, str(row[1]), str(row[2])):
                return False
            await cursor.execute(
                """UPDATE media_upload_sessions SET status='expired',failed_at=now(),updated_at=now()
                WHERE id=%s::uuid""",
                (session_id,),
            )
            return cursor.rowcount == 1


def _cleanup_workspaces(*, dry_run: bool, limit: int) -> int:
    configured = os.getenv("AUTOMATIC_CLIPPER_TEMP_ROOT", "").strip()
    if not configured:
        return 0
    root = Path(configured).resolve()
    if not root.is_dir():
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(
        hours=_hours("TEMP_WORKSPACE_RETENTION_HOURS", 24)
    )
    count = 0
    for child in root.iterdir():
        if count >= limit or not child.is_dir() or child.resolve().parent != root:
            continue
        if datetime.fromtimestamp(child.stat().st_mtime, timezone.utc) >= cutoff:
            continue
        count += 1
        if not dry_run:
            shutil.rmtree(child)
    return count


async def run_cleanup(*, dry_run: bool = False, batch_size: int = 500) -> dict[str, int]:
    database_url = (os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()
    limit = max(1, min(batch_size, 2_000))
    webhook_days = _days("WHOP_WEBHOOK_RETENTION_DAYS", 30)
    source_cutoff = datetime.now(timezone.utc) - timedelta(days=_days("SOURCE_MEDIA_RETENTION_DAYS", 7))
    export_cutoff = datetime.now(timezone.utc) - timedelta(days=_days("EXPORT_RETENTION_DAYS", 7))
    counts: dict[str, int] = {"sourceMedia": 0, "exports": 0, "uploadSessions": 0}
    async with await psycopg.AsyncConnection.connect(database_url, connect_timeout=5) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """SELECT id FROM media_assets m WHERE deleted_at IS NULL AND updated_at < %s
                AND storage_bucket IS NOT NULL AND storage_path IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM clip_projects p WHERE p.source_media_asset_id=m.id
                  AND p.deleted_at IS NULL AND p.archived_at IS NULL) LIMIT %s""",
                (source_cutoff, limit),
            )
            sources = [str(row[0]) for row in await cursor.fetchall()]
            await cursor.execute(
                "SELECT id FROM clipping_exports WHERE status='ready' AND ready_at < %s LIMIT %s",
                (export_cutoff, limit),
            )
            exports = [str(row[0]) for row in await cursor.fetchall()]
            await cursor.execute(
                """SELECT id FROM media_upload_sessions WHERE expires_at < now()
                AND status NOT IN ('completed','failed','expired','cancelled') LIMIT %s""",
                (limit,),
            )
            uploads = [str(row[0]) for row in await cursor.fetchall()]
        if dry_run:
            counts.update(sourceMedia=len(sources), exports=len(exports), uploadSessions=len(uploads))
        elif sources or exports or uploads:
            storage_config = MediaStorageConfig.from_env()
            for asset_id in sources:
                counts["sourceMedia"] += await _expire_source(connection, asset_id, source_cutoff, storage_config)
            for export_id in exports:
                counts["exports"] += await _expire_export(connection, export_id, export_cutoff, storage_config)
            for session_id in uploads:
                counts["uploadSessions"] += await _expire_upload(connection, session_id, storage_config)
        async with connection.transaction():
            async with connection.cursor() as cursor:
                statements = {
                    "expiredReservations": """UPDATE usage_reservations SET status='released',final_quantity=0,updated_at=now()
                      WHERE id IN (SELECT id FROM usage_reservations WHERE status='reserved' AND expires_at < now() LIMIT %s)""",
                    "expiredHandoffs": """UPDATE project_handoffs SET status='expired',updated_at=now()
                      WHERE id IN (SELECT id FROM project_handoffs WHERE status IN ('prepared','claimed') AND expires_at < now() LIMIT %s)""",
                    "webhookEvents": """DELETE FROM whop_webhook_events WHERE event_id IN (SELECT event_id FROM whop_webhook_events
                      WHERE received_at < now()-(%s * interval '1 day') LIMIT %s)""",
                    "idempotencyRecords": """DELETE FROM idempotency_records WHERE id IN (SELECT id FROM idempotency_records
                      WHERE expires_at IS NOT NULL AND expires_at < now() LIMIT %s)""",
                }
                for name, statement in statements.items():
                    params = (webhook_days, limit) if name == "webhookEvents" else (limit,)
                    if dry_run:
                        counts[name] = 0
                        continue
                    await cursor.execute(statement, params)
                    counts[name] = cursor.rowcount
    counts["workspaces"] = _cleanup_workspaces(dry_run=dry_run, limit=limit)
    logger.info("production_cleanup counts=%s dry_run=%s", counts, dry_run)
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    asyncio.run(run_cleanup(dry_run=args.dry_run, batch_size=args.batch_size))
