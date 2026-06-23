import json
import os
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

from .api.export_jobs import cancel_project_exports
from .database import DB_PATH, runtime_db
from .operational_mirror import flush_operational_outbox, mirror_deleted_project
from .settings import CACHE_DIR, EXPORT_DIR, MEDIA_DIR, TEMP_DIR, UPLOAD_DIR
from .storage_paths import path_inside, safe_identifier
from .worker_startup import cancel_pipeline_workers


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _elapsed_seconds(start: str | None, end: str | None) -> float | None:
    if not start or not end:
        return None
    try:
        return max(
            0.0,
            (
                datetime.fromisoformat(end.replace("Z", "+00:00"))
                - datetime.fromisoformat(start.replace("Z", "+00:00"))
            ).total_seconds(),
        )
    except (TypeError, ValueError):
        return None


def _safe_json(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


async def _retained_metadata(
    db: aiosqlite.Connection, project_id: str, user_id: str
) -> dict:
    jobs_cursor = await db.execute(
        "SELECT * FROM jobs WHERE project_id = ? AND user_id = ? ORDER BY created_at",
        (project_id, user_id),
    )
    jobs = await jobs_cursor.fetchall()
    exports_cursor = await db.execute(
        """
        SELECT * FROM export_jobs
        WHERE project_id = ? AND user_id = ? ORDER BY created_at
        """,
        (project_id, user_id),
    )
    exports = await exports_cursor.fetchall()
    media_cursor = await db.execute(
        """
        SELECT size_bytes FROM media_assets
        WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL
        """,
        (project_id, user_id),
    )
    media_rows = await media_cursor.fetchall()

    last_job = jobs[-1] if jobs else None
    transcript = _safe_json(last_job["transcript_json"]) if last_job else {}
    segments = transcript.get("segments")
    if not isinstance(segments, list):
        segments = []
    word_count = sum(
        len(segment.get("words") or [])
        for segment in segments
        if isinstance(segment, dict)
    )
    provider = transcript.get("provider")
    if isinstance(provider, dict):
        caption_model = provider.get("model") or provider.get("name")
    else:
        caption_model = provider
    last_export = exports[-1] if exports else None
    performance = (
        _safe_json(last_export["performance_json"])
        if last_export and "performance_json" in last_export.keys()
        else {}
    )
    created_at = jobs[0]["created_at"] if jobs else None
    normalized_error = None
    if last_export and last_export["error"]:
        normalized_error = str(last_export["stage"] or "export_failed")[:100]
    elif last_job and last_job["error"]:
        normalized_error = "caption_generation_failed"

    return {
        "project_id": project_id,
        "owner_id": user_id,
        "project_created_at": created_at,
        "deleted_at": _now(),
        "source_duration_seconds": (
            last_job["media_duration_seconds"] if last_job else None
        ),
        "source_size_bytes": sum(int(row["size_bytes"] or 0) for row in media_rows),
        "caption_language": last_job["target_lang"] if last_job else None,
        "caption_word_count": word_count,
        "caption_chunk_count": len(segments),
        "caption_model": str(caption_model)[:100] if caption_model else None,
        "generation_status": last_job["status"] if last_job else None,
        "generation_processing_seconds": (
            _elapsed_seconds(
                last_job["started_at"] or last_job["created_at"],
                last_job["completed_at"],
            )
            if last_job
            else None
        ),
        "export_attempt_count": len(exports),
        "export_format": "mp4" if exports else None,
        "export_width": last_export["width"] if last_export else None,
        "export_height": last_export["height"] if last_export else None,
        "export_fps": last_export["fps"] if last_export else None,
        "export_duration_seconds": last_export["duration"] if last_export else None,
        "export_output_size_bytes": last_export["bytes"] if last_export else None,
        "export_processing_seconds": (
            performance.get("totalElapsedSeconds")
            or performance.get("total_seconds")
        ),
        "export_status": last_export["status"] if last_export else None,
        "normalized_error_code": normalized_error,
        "deletion_status": "completed",
    }


def _remove_path(path: Path, root: Path) -> int:
    try:
        resolved = path.resolve()
        resolved.relative_to(root.resolve())
    except (OSError, ValueError):
        return 0
    if not resolved.exists():
        return 0
    if resolved.is_dir():
        import shutil

        shutil.rmtree(resolved)
    else:
        resolved.unlink()
    return 1


async def delete_project_resources(project_id: str, user_id: str) -> dict:
    safe_identifier(project_id, label="project id")
    async with runtime_db(path=DB_PATH, row_factory=True) as db:
        existing = await (
            await db.execute(
                "SELECT * FROM project_deletions WHERE project_id = ? AND user_id = ?",
                (project_id, user_id),
            )
        ).fetchone()
        if existing and existing["status"] == "completed":
            return {"projectId": project_id, "status": "completed", "removed": 0}

        owned = await (
            await db.execute(
                """
                SELECT 1 FROM jobs WHERE project_id = ? AND user_id = ?
                UNION ALL
                SELECT 1 FROM media_assets WHERE project_id = ? AND user_id = ?
                LIMIT 1
                """,
                (project_id, user_id, project_id, user_id),
            )
        ).fetchone()
        if not owned and not existing:
            return {"projectId": project_id, "status": "completed", "removed": 0}

        metadata = await _retained_metadata(db, project_id, user_id)
        await db.execute(
            """
            INSERT INTO project_deletions (
              project_id, user_id, status, requested_at, retained_metadata_json
            ) VALUES (?, ?, 'deleting', ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
              status = 'deleting', error_code = NULL,
              retained_metadata_json = excluded.retained_metadata_json
            """,
            (project_id, user_id, _now(), json.dumps(metadata)),
        )
        await db.execute(
            """
            UPDATE jobs SET status = 'cancelled', progress = -1,
              error = 'project_deleted', completed_at = CURRENT_TIMESTAMP
            WHERE project_id = ? AND user_id = ?
            """,
            (project_id, user_id),
        )
        await db.execute(
            """
            UPDATE export_jobs SET status = 'cancelled', stage = 'cancelled',
              progress = -1, error = 'project_deleted', updated_at = ?
            WHERE project_id = ? AND user_id = ?
            """,
            (_now(), project_id, user_id),
        )
        await db.commit()

        job_ids = [
            str(row["id"])
            for row in await (
                await db.execute(
                    "SELECT id FROM jobs WHERE project_id = ? AND user_id = ?",
                    (project_id, user_id),
                )
            ).fetchall()
        ]
        export_ids = [
            str(row["id"])
            for row in await (
                await db.execute(
                    """
                    SELECT id FROM export_jobs
                    WHERE project_id = ? AND user_id = ?
                    """,
                    (project_id, user_id),
                )
            ).fetchall()
        ]
        timed_out = await cancel_pipeline_workers(job_ids)
        if timed_out:
            raise RuntimeError("Active caption workers did not stop safely.")
        await cancel_project_exports(project_id)
        stale_record_ids = [*job_ids, *export_ids]
        if stale_record_ids:
            placeholders = ", ".join("?" for _ in stale_record_ids)
            await db.execute(
                f"""
                DELETE FROM operational_outbox
                WHERE record_id IN ({placeholders})
                """,
                stale_record_ids,
            )
            await db.commit()
        deletion_event_id = await mirror_deleted_project(metadata)
        flush = await flush_operational_outbox(
            1, event_id=deletion_event_id
        )
        if os.getenv("NODE_ENV") == "production" and flush["failed"]:
            await db.execute(
                """
                UPDATE project_deletions
                SET status = 'failed', error_code = 'retained_metadata_unavailable'
                WHERE project_id = ?
                """,
                (project_id,),
            )
            await db.commit()
            raise RuntimeError("Retained deletion metadata could not be persisted.")

        job_rows = await (
            await db.execute(
                "SELECT id FROM jobs WHERE project_id = ? AND user_id = ?",
                (project_id, user_id),
            )
        ).fetchall()
        export_rows = await (
            await db.execute(
                """
                SELECT id, output_path FROM export_jobs
                WHERE project_id = ? AND user_id = ?
                """,
                (project_id, user_id),
            )
        ).fetchall()
        media_rows = await (
            await db.execute(
                """
                SELECT storage_path FROM media_assets
                WHERE project_id = ? AND user_id = ?
                """,
                (project_id, user_id),
            )
        ).fetchall()

        removed = 0
        identifiers = {
            project_id,
            *[str(row["id"]) for row in job_rows],
            *[str(row["id"]) for row in export_rows],
        }
        for row in media_rows:
            removed += _remove_path(Path(row["storage_path"]), MEDIA_DIR)
        removed += _remove_path(path_inside(MEDIA_DIR, project_id), MEDIA_DIR)
        for row in job_rows:
            prefix = f"{row['id']}_"
            for path in UPLOAD_DIR.glob(f"{prefix}*"):
                removed += _remove_path(path, UPLOAD_DIR)
        for row in export_rows:
            if row["output_path"]:
                removed += _remove_path(Path(row["output_path"]), EXPORT_DIR)
            for path in EXPORT_DIR.glob(f"{row['id']}_*"):
                removed += _remove_path(path, EXPORT_DIR)
        removed += _remove_path(path_inside(CACHE_DIR, project_id), CACHE_DIR)
        if TEMP_DIR.exists():
            for path in list(TEMP_DIR.iterdir()):
                if any(
                    path.name == identifier
                    or f"_{identifier}_" in path.name
                    or path.name.startswith(f"{identifier}_")
                    for identifier in identifiers
                ):
                    removed += _remove_path(path, TEMP_DIR)
        logs_dir = TEMP_DIR / "logs"
        if logs_dir.exists():
            for path in list(logs_dir.rglob("*")):
                if path.is_file() and any(
                    path.name == identifier
                    or f"_{identifier}_" in path.name
                    or path.name.startswith(f"{identifier}_")
                    for identifier in identifiers
                ):
                    removed += _remove_path(path, logs_dir)

        await db.execute(
            "DELETE FROM export_jobs WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        )
        await db.execute(
            "DELETE FROM jobs WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        )
        await db.execute(
            "DELETE FROM media_assets WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        )
        await db.execute(
            """
            UPDATE project_deletions
            SET status = 'completed', completed_at = ?, error_code = NULL
            WHERE project_id = ?
            """,
            (_now(), project_id),
        )
        await db.commit()
        return {"projectId": project_id, "status": "completed", "removed": removed}
