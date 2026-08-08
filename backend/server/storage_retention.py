import asyncio
import logging
import shutil
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aiosqlite

from .database import DB_PATH
from .settings import (
    ABANDONED_UPLOAD_RETENTION_HOURS,
    CACHE_DIR,
    DOWNLOAD_ARTIFACT_RETENTION_HOURS,
    EXPORT_DIR,
    FAILED_EXPORT_RETENTION_HOURS,
    MEDIA_DIR,
    ORPHAN_SCAN_INTERVAL_SECONDS,
    TEMP_AUDIO_RETENTION_HOURS,
    TEMP_DIR,
    UPLOAD_DIR,
)

logger = logging.getLogger(__name__)
_sweep_lock = asyncio.Lock()


def _older_than(path: Path, cutoff: datetime) -> bool:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) < cutoff
    except OSError:
        return False


def _delete(path: Path, root: Path) -> int:
    try:
        resolved = path.resolve()
        resolved.relative_to(root.resolve())
        if not resolved.is_file():
            return 0
        resolved.unlink(missing_ok=True)
        return 1
    except (OSError, ValueError):
        return 0


def _delete_tree(path: Path, root: Path) -> int:
    try:
        resolved = path.resolve()
        resolved.relative_to(root.resolve())
        if not resolved.is_dir():
            return 0
        shutil.rmtree(resolved)
        return 1
    except (OSError, ValueError):
        return 0


async def cleanup_retained_storage(now: datetime | None = None) -> dict[str, int]:
    current = now or datetime.now(timezone.utc)
    removed = {
        "abandonedUploads": 0,
        "failedExports": 0,
        "expiredExports": 0,
        "temporaryAudio": 0,
        "renderTemporary": 0,
        "orphans": 0,
        "expiredProjects": 0,
        "resumedProjectDeletions": 0,
    }
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        active_jobs = {
            row["id"]
            for row in await (
                await db.execute(
                    """
                    SELECT id FROM jobs
                    WHERE status IN ('queued','running','processing','transcribing',
                      'aligning','normalizing','extracting_audio','romanizing',
                      'chunking','rendering','finalizing','exporting')
                    """
                )
            ).fetchall()
        }
        active_exports = {
            row["id"]
            for row in await (
                await db.execute(
                    "SELECT id FROM export_jobs WHERE status IN ('queued','running')"
                )
            ).fetchall()
        }
        known_upload_prefixes = {
            f"{row['id']}_"
            for row in await (await db.execute("SELECT id FROM jobs")).fetchall()
        }
        known_export_paths = {
            str(Path(row["output_path"]).resolve())
            for row in await (
                await db.execute(
                    "SELECT output_path FROM export_jobs WHERE output_path IS NOT NULL"
                )
            ).fetchall()
        }
        known_media_paths = {
            str(Path(row["storage_path"]).resolve())
            for row in await (
                await db.execute(
                    "SELECT storage_path FROM media_assets WHERE deleted_at IS NULL"
                )
            ).fetchall()
        }
        failed_exports = await (
            await db.execute(
                """
                SELECT id, output_path FROM export_jobs
                WHERE status IN ('failed','cancelled')
                """
            )
        ).fetchall()
        completed_exports = await (
            await db.execute(
                "SELECT id, output_path FROM export_jobs WHERE status = 'completed'"
            )
        ).fetchall()
        expired_projects = await (
            await db.execute(
                """
                SELECT DISTINCT COALESCE(project_id, id) AS project_id, user_id
                FROM jobs
                WHERE (status = 'expired' OR deleted_at IS NOT NULL)
                  AND user_id IS NOT NULL
                """
            )
        ).fetchall()
        try:
            interrupted_deletions = await (
                await db.execute(
                    """
                    SELECT DISTINCT project_id, user_id
                    FROM project_deletions
                    WHERE status IN ('queued','deleting')
                      AND project_id IS NOT NULL
                      AND user_id IS NOT NULL
                    """
                )
            ).fetchall()
        except aiosqlite.OperationalError:
            interrupted_deletions = []

    if expired_projects or interrupted_deletions:
        from .project_deletion import delete_project_resources

        for row in expired_projects:
            result = await delete_project_resources(
                str(row["project_id"]), str(row["user_id"])
            )
            if result["status"] == "completed":
                removed["expiredProjects"] += 1
        for row in interrupted_deletions:
            result = await delete_project_resources(
                str(row["project_id"]), str(row["user_id"])
            )
            if result["status"] == "completed":
                removed["resumedProjectDeletions"] += 1

    upload_cutoff = current - timedelta(hours=ABANDONED_UPLOAD_RETENTION_HOURS)
    for path in UPLOAD_DIR.glob("*"):
        if any(path.name.startswith(prefix) for prefix in known_upload_prefixes):
            continue
        if _older_than(path, upload_cutoff):
            removed["abandonedUploads"] += _delete(path, UPLOAD_DIR)

    failed_cutoff = current - timedelta(hours=FAILED_EXPORT_RETENTION_HOURS)
    for row in failed_exports:
        if row["id"] in active_exports or not row["output_path"]:
            continue
        path = Path(row["output_path"])
        if _older_than(path, failed_cutoff):
            removed["failedExports"] += _delete(path, EXPORT_DIR)

    export_cutoff = current - timedelta(hours=DOWNLOAD_ARTIFACT_RETENTION_HOURS)
    for row in completed_exports:
        if not row["output_path"]:
            continue
        path = Path(row["output_path"])
        if _older_than(path, export_cutoff):
            removed["expiredExports"] += _delete(path, EXPORT_DIR)

    audio_cutoff = current - timedelta(hours=TEMP_AUDIO_RETENTION_HOURS)
    for path in TEMP_DIR.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".wav", ".mp3", ".m4a"}:
            continue
        if any(identifier in path.name for identifier in active_jobs):
            continue
        if _older_than(path, audio_cutoff):
            removed["temporaryAudio"] += _delete(path, TEMP_DIR)

    render_cutoff = current - timedelta(hours=FAILED_EXPORT_RETENTION_HOURS)
    active_identifiers = active_jobs | active_exports
    for path in TEMP_DIR.iterdir():
        if not path.is_dir() or not path.name.startswith(
            ("capinsta_capture_", "capinsta_sparse_", "huygen_frames_")
        ):
            continue
        if any(identifier in path.name for identifier in active_identifiers):
            continue
        if _older_than(path, render_cutoff):
            removed["renderTemporary"] += _delete_tree(path, TEMP_DIR)

    for root, known in (
        (EXPORT_DIR, known_export_paths),
        (MEDIA_DIR, known_media_paths),
    ):
        for path in root.rglob("*"):
            if path.is_file() and str(path.resolve()) not in known:
                if _older_than(path, upload_cutoff):
                    removed["orphans"] += _delete(path, root)
    return removed


async def run_storage_retention_sweep(reason: str = "scheduled") -> dict[str, int] | None:
    if _sweep_lock.locked():
        logger.info("storage_retention_skipped reason=%s already_running=true", reason)
        return None
    async with _sweep_lock:
        try:
            removed = await cleanup_retained_storage()
        except Exception:
            logger.exception("storage_retention_failed reason=%s", reason)
            return None
        total = sum(int(value) for value in removed.values())
        logger.info(
            "storage_retention_completed reason=%s total_removed=%s details=%s",
            reason,
            total,
            removed,
        )
        return removed


async def storage_retention_loop() -> None:
    await run_storage_retention_sweep(reason="startup")
    while True:
        await asyncio.sleep(ORPHAN_SCAN_INTERVAL_SECONDS)
        await run_storage_retention_sweep(reason="scheduled")


async def stop_storage_retention(task: asyncio.Task | None) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
