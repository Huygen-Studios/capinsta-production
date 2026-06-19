import asyncio
import logging
import shutil
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aiosqlite
from fastapi import HTTPException

from .settings import (
    CACHE_DIR,
    DB_PATH,
    EXPORT_DIR,
    PROJECT_CLEANUP_INTERVAL_SECONDS,
    PROJECT_INACTIVITY_TTL_MINUTES,
    PROJECT_MAX_LIFETIME_MINUTES,
    TEMP_DIR,
    UPLOAD_DIR,
)

logger = logging.getLogger(__name__)

ACTIVE_JOB_STATUSES = {
    "queued", "running", "processing", "transcribing", "aligning",
    "normalizing", "extracting_audio", "romanizing", "chunking",
    "rendering", "finalizing", "exporting",
}
ACTIVE_EXPORT_STATUSES = {"queued", "running"}
EXPIRED_MESSAGE = (
    "This project expired after 15 minutes of inactivity. Please start a new project."
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def project_expiry(now: datetime, created_at: str | None = None) -> datetime:
    # A visible editor always wins: the configured maximum lifetime must never
    # cause deletion while a client is actively renewing its lease.
    return now + timedelta(minutes=PROJECT_INACTIVITY_TTL_MINUTES)


def is_deleted_row(row) -> bool:
    keys = row.keys()
    return (
        ("deleted_at" in keys and bool(row["deleted_at"]))
        or ("status" in keys and row["status"] == "expired")
    )


def raise_if_deleted(row) -> None:
    if is_deleted_row(row):
        raise HTTPException(status_code=410, detail=EXPIRED_MESSAGE)


async def ensure_project_available(row, db: aiosqlite.Connection) -> None:
    raise_if_deleted(row)
    expiry = parse_utc(row["expires_at"] if "expires_at" in row.keys() else None)
    if expiry and expiry <= utc_now() and row["status"] not in ACTIVE_JOB_STATUSES:
        await expire_project(str(row["id"]), db, reason="inactivity_timeout")
        raise HTTPException(status_code=410, detail=EXPIRED_MESSAGE)


async def heartbeat_project(job_id: str, db: aiosqlite.Connection) -> dict[str, str]:
    cursor = await db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    await ensure_project_available(row, db)

    now = utc_now()
    expires = project_expiry(now, str(row["created_at"]))
    now_text = iso_utc(now)
    expires_text = iso_utc(expires)
    await db.execute(
        "UPDATE jobs SET last_seen_at = ?, expires_at = ? WHERE id = ?",
        (now_text, expires_text, job_id),
    )
    await db.execute(
        """
        UPDATE export_jobs SET expires_at = ?
        WHERE source_job_id = ? AND deleted_at IS NULL
        """,
        (expires_text, job_id),
    )
    await db.commit()
    return {"job_id": job_id, "last_seen_at": now_text, "expires_at": expires_text}


def _safe_remove(path: Path, root: Path) -> bool:
    try:
        resolved = path.resolve()
        resolved.relative_to(root.resolve())
        if not resolved.exists():
            return False
        if resolved.is_dir():
            shutil.rmtree(resolved)
        else:
            resolved.unlink()
        return True
    except (OSError, ValueError):
        return False


def remove_project_files(job_id: str, export_paths: list[str], export_job_ids: list[str]) -> int:
    removed = 0
    identifiers = [job_id, *export_job_ids]
    for root in (UPLOAD_DIR, EXPORT_DIR, CACHE_DIR):
        if not root.exists():
            continue
        for path in list(root.rglob("*")):
            relative = str(path.relative_to(root))
            if any(identifier in relative for identifier in identifiers) and _safe_remove(path, root):
                removed += 1

    # Export filenames are normally keyed by export-job id, so use the DB paths too.
    for raw_path in export_paths:
        if raw_path and _safe_remove(Path(raw_path), EXPORT_DIR):
            removed += 1

    # Remove only job-keyed temp entries; never traverse/delete the DB itself.
    if TEMP_DIR.exists():
        for path in list(TEMP_DIR.iterdir()):
            if any(identifier in path.name for identifier in identifiers) and _safe_remove(path, TEMP_DIR):
                removed += 1
    return removed


async def expire_project(
    job_id: str,
    db: aiosqlite.Connection,
    *,
    now: datetime | None = None,
    reason: str = "inactivity_timeout",
) -> int:
    now_text = iso_utc(now or utc_now())
    cursor = await db.execute(
        "SELECT id, output_path FROM export_jobs WHERE source_job_id = ?", (job_id,)
    )
    export_rows = await cursor.fetchall()
    export_paths = [str(row["output_path"] or "") for row in export_rows]
    export_job_ids = [str(row["id"]) for row in export_rows]
    await db.execute(
        """
        UPDATE jobs SET status = 'expired', deleted_at = ?, delete_reason = ?
        WHERE id = ? AND deleted_at IS NULL
        """,
        (now_text, reason, job_id),
    )
    await db.execute(
        """
        UPDATE export_jobs
        SET status = 'expired', deleted_at = ?, delete_reason = ?, updated_at = ?
        WHERE source_job_id = ? AND deleted_at IS NULL
        """,
        (now_text, reason, now_text, job_id),
    )
    await db.commit()
    return remove_project_files(job_id, export_paths, export_job_ids)


async def cleanup_expired_projects(
    *, db_path: Path = DB_PATH, now: datetime | None = None
) -> tuple[int, int]:
    current = now or utc_now()
    expired_before = iso_utc(current)
    projects = files = 0
    async with aiosqlite.connect(str(db_path)) as db:
        db.row_factory = aiosqlite.Row
        # Legacy rows have no lease. Give them a bounded orphan lifetime while
        # allowing a returning visible editor to renew before the first sweep.
        legacy_cursor = await db.execute(
            """
            SELECT id, created_at FROM jobs
            WHERE deleted_at IS NULL AND expires_at IS NULL
              AND status NOT IN ('queued', 'running', 'processing', 'transcribing',
                'aligning', 'normalizing', 'extracting_audio', 'romanizing',
                'chunking', 'rendering', 'finalizing', 'exporting')
            """
        )
        for legacy in await legacy_cursor.fetchall():
            created = parse_utc(legacy["created_at"]) or current
            await db.execute(
                "UPDATE jobs SET expires_at = ? WHERE id = ?",
                (
                    iso_utc(created + timedelta(minutes=PROJECT_MAX_LIFETIME_MINUTES)),
                    legacy["id"],
                ),
            )
        await db.commit()
        cursor = await db.execute(
            """
            SELECT id, status FROM jobs
            WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
            """,
            (expired_before,),
        )
        for row in await cursor.fetchall():
            if row["status"] in ACTIVE_JOB_STATUSES:
                continue
            active_export = await db.execute(
                """
                SELECT 1 FROM export_jobs
                WHERE source_job_id = ? AND deleted_at IS NULL
                  AND status IN ('queued', 'running') LIMIT 1
                """,
                (row["id"],),
            )
            if await active_export.fetchone():
                continue
            files += await expire_project(row["id"], db, now=current)
            projects += 1
    return projects, files


async def project_cleanup_loop() -> None:
    while True:
        await asyncio.sleep(PROJECT_CLEANUP_INTERVAL_SECONDS)
        try:
            projects, files = await cleanup_expired_projects()
            if projects:
                logger.info("project_cleanup expired_projects=%s removed_files=%s", projects, files)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("project_cleanup_failed")


async def stop_cleanup_task(task: asyncio.Task | None) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
