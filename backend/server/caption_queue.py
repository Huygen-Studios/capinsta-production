import asyncio
import logging
import os
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import aiosqlite

from .database import DB_PATH
from .project_cleanup import iso_utc
from .worker_startup import active_pipeline_worker_count, start_pipeline_worker

logger = logging.getLogger(__name__)

RUNNING_STATUSES = {
    "queued",
    "pending",
    "uploaded",
    "extracting",
    "processing",
    "running",
    "started",
    "extracting_audio",
    "transcribing",
    "aligning",
    "normalizing",
    "romanizing",
    "chunking",
    "rendering",
    "rendering_captions",
    "finalizing",
    "saving",
    "generating_captions",
}


class CaptionQueueError(RuntimeError):
    status_code = 503
    code = "caption_queue_error"


class CaptionQueueUnavailable(CaptionQueueError):
    code = "caption_queue_unavailable"


class CaptionQueueOverloaded(CaptionQueueError):
    code = "caption_queue_overloaded"


@dataclass(frozen=True)
class CaptionQueueResult:
    adapter: str
    job_id: str
    worker_started: bool
    active_workers: int
    queued_jobs: int


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _queue_mode() -> str:
    return (os.getenv("CAPTION_QUEUE_MODE") or "local").strip().lower()


async def _count_user_running_jobs(db: aiosqlite.Connection, user_id: str) -> int:
    placeholders = ",".join("?" for _ in RUNNING_STATUSES)
    cursor = await db.execute(
        f"SELECT COUNT(*) FROM jobs WHERE user_id = ? AND status IN ({placeholders})",
        (user_id, *RUNNING_STATUSES),
    )
    row = await cursor.fetchone()
    return int(row[0] or 0)


async def _count_global_running_jobs(db: aiosqlite.Connection) -> int:
    placeholders = ",".join("?" for _ in RUNNING_STATUSES)
    cursor = await db.execute(
        f"SELECT COUNT(*) FROM jobs WHERE status IN ({placeholders})",
        tuple(RUNNING_STATUSES),
    )
    row = await cursor.fetchone()
    return int(row[0] or 0)


async def enforce_caption_queue_limits(
    db: aiosqlite.Connection,
    *,
    user_id: str,
) -> tuple[int, int, int]:
    per_user_limit = _env_int("CAPTION_QUEUE_MAX_USER_RUNNING", 2, 1)
    global_limit = _env_int("CAPTION_QUEUE_MAX_GLOBAL_RUNNING", 8, 1)
    depth_limit = _env_int("CAPTION_QUEUE_MAX_DEPTH", 100, 1)
    user_running = await _count_user_running_jobs(db, user_id)
    global_running = await _count_global_running_jobs(db)
    active_workers = active_pipeline_worker_count()
    if user_running > per_user_limit:
        raise CaptionQueueOverloaded("Too many caption jobs are already queued for this user.")
    if global_running > depth_limit or active_workers >= global_limit:
        raise CaptionQueueOverloaded("Caption queue is busy. Please retry shortly.")
    return user_running, global_running, active_workers


async def reconcile_stale_caption_jobs(db: aiosqlite.Connection) -> int:
    lease_seconds = _env_int("CAPTION_QUEUE_LEASE_TIMEOUT_SECONDS", 300, 30)
    max_retries = _env_int("CAPTION_QUEUE_MAX_RETRIES", 2, 0)
    now = datetime.now(timezone.utc)
    stale_before = iso_utc(now - timedelta(seconds=lease_seconds))
    jitter_seconds = random.randint(0, _env_int("CAPTION_QUEUE_RETRY_JITTER_SECONDS", 15, 0))
    retry_at = iso_utc(now + timedelta(seconds=jitter_seconds))
    placeholders = ",".join("?" for _ in RUNNING_STATUSES)
    cursor = await db.execute(
        f"""
        SELECT id, retry_count
        FROM jobs
        WHERE status IN ({placeholders})
          AND COALESCE(heartbeat_at, updated_at, created_at) < ?
        """,
        (*RUNNING_STATUSES, stale_before),
    )
    rows = await cursor.fetchall()
    changed = 0
    for row in rows:
        retry_count = int(row["retry_count"] or 0) if isinstance(row, aiosqlite.Row) else int(row[1] or 0)
        job_id = row["id"] if isinstance(row, aiosqlite.Row) else row[0]
        if retry_count < max_retries:
            await db.execute(
                """
                UPDATE jobs
                SET status = 'queued',
                    progress = 0,
                    retry_count = COALESCE(retry_count, 0) + 1,
                    message = 'Caption worker lease expired; job was requeued.',
                    heartbeat_at = ?,
                    updated_at = ?
                WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
                """,
                (retry_at, retry_at, job_id),
            )
        else:
            await db.execute(
                """
                UPDATE jobs
                SET status = 'failed',
                    progress = -1,
                    error = 'Caption worker lease expired after bounded retries.',
                    message = 'Caption worker lease expired after bounded retries.',
                    completed_at = ?,
                    updated_at = ?
                WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
                """,
                (iso_utc(now), iso_utc(now), job_id),
            )
        changed += 1
    if changed:
        await db.commit()
    return changed


async def enqueue_caption_job(
    *,
    job_id: str,
    user_id: str,
    file_path: str,
    language_mode: str,
    caption_output: str,
    transcription_config_snapshot: dict[str, Any] | None,
) -> CaptionQueueResult:
    mode = _queue_mode()
    if mode in {"redis", "upstash"}:
        if not os.getenv("UPSTASH_REDIS_REST_URL") or not os.getenv("UPSTASH_REDIS_REST_TOKEN"):
            raise CaptionQueueUnavailable("Redis caption queue is not configured.")
        raise CaptionQueueUnavailable("Redis caption queue adapter is not enabled in this build.")
    if mode not in {"local", "dev", "thread"}:
        raise CaptionQueueUnavailable(f"Unsupported caption queue mode: {mode}.")

    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        await reconcile_stale_caption_jobs(db)
        _, queued_jobs, active_workers = await enforce_caption_queue_limits(db, user_id=user_id)

    await asyncio.to_thread(
        start_pipeline_worker,
        job_id=job_id,
        file_path=file_path,
        language_mode=language_mode,
        caption_output=caption_output,
        transcription_config_snapshot=transcription_config_snapshot,
    )
    logger.info(
        "caption_queue_enqueued adapter=%s job_id=%s active_workers=%s queued_jobs=%s",
        mode,
        job_id,
        active_workers,
        queued_jobs,
    )
    return CaptionQueueResult(
        adapter=mode,
        job_id=job_id,
        worker_started=True,
        active_workers=active_workers,
        queued_jobs=queued_jobs,
    )
