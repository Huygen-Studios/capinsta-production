import asyncio
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

import aiosqlite

from .database import runtime_db
from .settings import DB_PATH

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None

logger = logging.getLogger(__name__)
_stop_event = asyncio.Event()
_SECRET_PATTERN = re.compile(
    r"(bearer\s+[a-z0-9._-]+|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+)",
    re.IGNORECASE,
)


def _database_url() -> str:
    return (os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()


def sanitize_error(value: object | None) -> str | None:
    if value is None:
        return None
    text = _SECRET_PATTERN.sub("[redacted]", str(value)).replace("\x00", "")
    return text[:1000]


def _stable_event_id(kind: str, record_id: str, updated_at: object) -> str:
    return hashlib.sha256(f"{kind}:{record_id}:{updated_at}".encode()).hexdigest()


async def _enqueue(kind: str, record_id: str, payload: dict[str, Any]) -> str:
    event_id = _stable_event_id(kind, record_id, payload.get("updated_at"))
    async with runtime_db(path=DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO operational_outbox
              (event_id, event_type, record_id, payload_json, attempts, created_at, next_attempt_at)
            VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(event_id) DO UPDATE SET payload_json = excluded.payload_json
            """,
            (event_id, kind, record_id, json.dumps(payload, ensure_ascii=False)),
        )
        await db.commit()
    return event_id


async def _write_caption(payload: dict[str, Any]) -> None:
    database_url = _database_url()
    if not database_url or psycopg is None:
        raise RuntimeError("Operational PostgreSQL mirror is not configured")
    query = """
        INSERT INTO caption_jobs (
          id, user_id, project_id, source_filename, language, provider,
          transcription_model, transcription_config_version, timestamp_strategy,
          provider_mode, provider_request_id, timing_source_summary, pipeline_options,
          media_duration_seconds, status, progress, word_count, caption_count,
          queued_at, started_at, completed_at, cancelled_at, retry_count,
          sanitized_error_code, sanitized_error_message, correlation_id,
          retry_of_job_id, admin_retry_by, created_at, updated_at
        ) VALUES (
          %(id)s, %(user_id)s::uuid, %(project_id)s, %(source_filename)s, %(language)s,
          %(provider)s, %(transcription_model)s, %(transcription_config_version)s,
          %(timestamp_strategy)s, %(provider_mode)s, %(provider_request_id)s,
          %(timing_source_summary)s::jsonb, %(pipeline_options)s::jsonb,
          %(media_duration_seconds)s, %(status)s, %(progress)s,
          %(word_count)s, %(caption_count)s, %(queued_at)s, %(started_at)s,
          %(completed_at)s, %(cancelled_at)s, %(retry_count)s,
          %(sanitized_error_code)s, %(sanitized_error_message)s,
          %(correlation_id)s::uuid, %(retry_of_job_id)s, %(admin_retry_by)s::uuid,
          %(created_at)s, %(updated_at)s
        )
        ON CONFLICT (id) DO UPDATE SET
          user_id = excluded.user_id,
          project_id = excluded.project_id,
          source_filename = excluded.source_filename,
          language = excluded.language,
          provider = excluded.provider,
          transcription_model = excluded.transcription_model,
          transcription_config_version = excluded.transcription_config_version,
          timestamp_strategy = excluded.timestamp_strategy,
          provider_mode = excluded.provider_mode,
          provider_request_id = excluded.provider_request_id,
          timing_source_summary = excluded.timing_source_summary,
          pipeline_options = excluded.pipeline_options,
          media_duration_seconds = excluded.media_duration_seconds,
          status = excluded.status,
          progress = excluded.progress,
          word_count = excluded.word_count,
          caption_count = excluded.caption_count,
          started_at = COALESCE(caption_jobs.started_at, excluded.started_at),
          completed_at = excluded.completed_at,
          cancelled_at = excluded.cancelled_at,
          retry_count = excluded.retry_count,
          sanitized_error_code = excluded.sanitized_error_code,
          sanitized_error_message = excluded.sanitized_error_message,
          correlation_id = COALESCE(caption_jobs.correlation_id, excluded.correlation_id),
          retry_of_job_id = excluded.retry_of_job_id,
          admin_retry_by = excluded.admin_retry_by,
          updated_at = excluded.updated_at
    """
    async with await psycopg.AsyncConnection.connect(database_url, connect_timeout=4) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(query, payload)
            await cursor.execute(
                """
                INSERT INTO project_registry (
                  project_id, user_id, name, last_heartbeat_at, expires_at, state,
                  caption_job_count, updated_at
                ) VALUES (%s, %s::uuid, %s, now(), NULL, %s, 1, now())
                ON CONFLICT (project_id) DO UPDATE SET
                  user_id = excluded.user_id,
                  state = excluded.state,
                  caption_job_count = GREATEST(project_registry.caption_job_count, 1),
                  updated_at = now()
                """,
                (
                    payload["project_id"],
                    payload["user_id"],
                    payload["source_filename"],
                    "active" if payload["status"] not in {"expired", "closed"} else payload["status"],
                ),
            )
            if payload["status"] == "completed" and payload.get("media_duration_seconds"):
                minutes = float(payload["media_duration_seconds"]) / 60
                await cursor.execute(
                    """
                    INSERT INTO usage_events
                      (event_key, user_id, project_id, event_type, numeric_value, metadata, correlation_id)
                    VALUES (%s, %s::uuid, %s, 'caption_minutes', %s, '{}'::jsonb, %s::uuid)
                    ON CONFLICT (event_key) DO NOTHING
                    """,
                    (
                        f"caption-completed:{payload['id']}",
                        payload["user_id"],
                        payload["project_id"],
                        minutes,
                        payload["correlation_id"],
                    ),
                )
        await connection.commit()


async def _write_export(payload: dict[str, Any]) -> None:
    database_url = _database_url()
    if not database_url or psycopg is None:
        raise RuntimeError("Operational PostgreSQL mirror is not configured")
    query = """
        INSERT INTO export_jobs (
          id, user_id, project_id, source_caption_job_id, mode, status, stage,
          progress, width, height, fps, duration_seconds, output_size_bytes,
          render_time_seconds, queued_at, started_at, completed_at, cancelled_at,
          retry_count, error_class, sanitized_error_message, output_expiry,
          correlation_id, retry_of_export_id, admin_retry_by, immutable_input,
          created_at, updated_at
        ) VALUES (
          %(id)s, %(user_id)s::uuid, %(project_id)s, %(source_caption_job_id)s,
          %(mode)s, %(status)s, %(stage)s, %(progress)s, %(width)s, %(height)s,
          %(fps)s, %(duration_seconds)s, %(output_size_bytes)s,
          %(render_time_seconds)s, %(queued_at)s, %(started_at)s, %(completed_at)s,
          %(cancelled_at)s, %(retry_count)s, %(error_class)s,
          %(sanitized_error_message)s, %(output_expiry)s,
          %(correlation_id)s::uuid, %(retry_of_export_id)s,
          %(admin_retry_by)s::uuid, %(immutable_input)s::jsonb,
          %(created_at)s, %(updated_at)s
        )
        ON CONFLICT (id) DO UPDATE SET
          user_id = excluded.user_id,
          project_id = excluded.project_id,
          source_caption_job_id = excluded.source_caption_job_id,
          mode = excluded.mode,
          status = excluded.status,
          stage = excluded.stage,
          progress = excluded.progress,
          width = excluded.width,
          height = excluded.height,
          fps = excluded.fps,
          duration_seconds = excluded.duration_seconds,
          output_size_bytes = excluded.output_size_bytes,
          render_time_seconds = excluded.render_time_seconds,
          started_at = COALESCE(export_jobs.started_at, excluded.started_at),
          completed_at = excluded.completed_at,
          cancelled_at = excluded.cancelled_at,
          retry_count = excluded.retry_count,
          error_class = excluded.error_class,
          sanitized_error_message = excluded.sanitized_error_message,
          output_expiry = excluded.output_expiry,
          correlation_id = COALESCE(export_jobs.correlation_id, excluded.correlation_id),
          retry_of_export_id = excluded.retry_of_export_id,
          admin_retry_by = excluded.admin_retry_by,
          immutable_input = COALESCE(export_jobs.immutable_input, excluded.immutable_input),
          updated_at = excluded.updated_at
    """
    async with await psycopg.AsyncConnection.connect(database_url, connect_timeout=4) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(query, payload)
            await cursor.execute(
                """
                INSERT INTO project_registry (
                  project_id, user_id, name, last_heartbeat_at, state,
                  export_job_count, updated_at
                ) VALUES (%s, %s::uuid, %s, now(), 'active', 1, now())
                ON CONFLICT (project_id) DO UPDATE SET
                  user_id = excluded.user_id,
                  export_job_count = GREATEST(project_registry.export_job_count, 1),
                  updated_at = now()
                """,
                (payload["project_id"], payload["user_id"], payload["project_id"]),
            )
            if payload["status"] == "completed" and payload.get("duration_seconds"):
                minutes = float(payload["duration_seconds"]) / 60
                await cursor.execute(
                    """
                    INSERT INTO usage_events
                      (event_key, user_id, project_id, event_type, numeric_value, metadata, correlation_id)
                    VALUES (%s, %s::uuid, %s, 'export_minutes', %s, '{}'::jsonb, %s::uuid)
                    ON CONFLICT (event_key) DO NOTHING
                    """,
                    (
                        f"export-completed:{payload['id']}",
                        payload["user_id"],
                        payload["project_id"],
                        minutes,
                        payload["correlation_id"],
                    ),
                )
        await connection.commit()


async def _write_deleted_project(payload: dict[str, Any]) -> None:
    database_url = _database_url()
    if not database_url or psycopg is None:
        raise RuntimeError("Operational PostgreSQL mirror is not configured")
    async with await psycopg.AsyncConnection.connect(
        database_url, connect_timeout=4
    ) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                INSERT INTO deleted_project_records (
                  project_id, owner_id, project_created_at, deleted_at,
                  source_duration_seconds, source_size_bytes, caption_language,
                  caption_word_count, caption_chunk_count, caption_model,
                  generation_status, generation_processing_seconds,
                  export_attempt_count, export_format, export_width,
                  export_height, export_fps, export_duration_seconds,
                  export_output_size_bytes, export_processing_seconds,
                  export_status, normalized_error_code, deletion_status
                ) VALUES (
                  %(project_id)s, %(owner_id)s::uuid, %(project_created_at)s,
                  %(deleted_at)s, %(source_duration_seconds)s,
                  %(source_size_bytes)s, %(caption_language)s,
                  %(caption_word_count)s, %(caption_chunk_count)s,
                  %(caption_model)s, %(generation_status)s,
                  %(generation_processing_seconds)s, %(export_attempt_count)s,
                  %(export_format)s, %(export_width)s, %(export_height)s,
                  %(export_fps)s, %(export_duration_seconds)s,
                  %(export_output_size_bytes)s, %(export_processing_seconds)s,
                  %(export_status)s, %(normalized_error_code)s,
                  %(deletion_status)s
                )
                ON CONFLICT (project_id) DO NOTHING
                """,
                payload,
            )
            await cursor.execute(
                "DELETE FROM export_jobs WHERE project_id = %s",
                (payload["project_id"],),
            )
            await cursor.execute(
                "DELETE FROM caption_jobs WHERE project_id = %s",
                (payload["project_id"],),
            )
            await cursor.execute(
                "DELETE FROM project_registry WHERE project_id = %s",
                (payload["project_id"],),
            )
        await connection.commit()


async def deleted_project_records_available() -> bool:
    database_url = _database_url()
    if not database_url or psycopg is None:
        logger.warning(
            "deleted_project_records_check status=unavailable reason=postgres_not_configured"
        )
        return False
    try:
        async with await psycopg.AsyncConnection.connect(
            database_url, connect_timeout=4
        ) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT to_regclass('public.deleted_project_records') IS NOT NULL"
                )
                row = await cursor.fetchone()
                available = bool(row and row[0])
    except Exception:
        logger.exception("deleted_project_records_check status=failed")
        return False
    if available:
        logger.info("deleted_project_records_check status=ok")
    else:
        logger.warning(
            "deleted_project_records_check status=missing action=apply_migration_before_project_deletion"
        )
    return available


async def deliver_event(kind: str, payload: dict[str, Any]) -> None:
    if kind == "caption_job":
        await _write_caption(payload)
    elif kind == "export_job":
        await _write_export(payload)
    elif kind == "deleted_project":
        await _write_deleted_project(payload)
    else:
        raise ValueError(f"Unsupported operational event type: {kind}")


async def mirror_event(kind: str, record_id: str, payload: dict[str, Any]) -> str:
    # Durable local outbox first: runtime work never waits on PostgreSQL and an
    # abrupt mirror outage cannot silently lose the latest state.
    return await _enqueue(kind, record_id, payload)


async def caption_payload(job_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = await cursor.fetchone()
    if not row:
        return None
    transcript = {}
    try:
        transcript = json.loads(row["transcript_json"] or "{}")
    except (TypeError, json.JSONDecodeError):
        pass
    segments = transcript.get("segments") if isinstance(transcript, dict) else []
    metadata = transcript.get("metadata") if isinstance(transcript, dict) else {}
    provider = transcript.get("provider") if isinstance(transcript, dict) else None
    if isinstance(provider, dict):
        provider_name = provider.get("name")
        provider_model = provider.get("model")
    else:
        provider_name = provider
        provider_model = None
    timing_summary = {}
    pipeline_options = {}
    if isinstance(metadata, dict):
        timing = metadata.get("timing")
        if isinstance(timing, dict):
            report = timing.get("report")
            if isinstance(report, dict):
                timing_summary = report.get("timingSourceCounts") or {}
                pipeline_options = timing.get("resolvedPipelineOptions") or {}
    now = datetime.now(timezone.utc).isoformat()
    status = row["status"]
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "project_id": row["project_id"] if "project_id" in row.keys() else row["id"],
        "source_filename": row["filename"],
        "language": row["target_lang"],
        "provider": row["transcription_provider"] if "transcription_provider" in row.keys() and row["transcription_provider"] else provider_name or (metadata.get("provider") if isinstance(metadata, dict) else None),
        "transcription_model": row["transcription_model"] if "transcription_model" in row.keys() and row["transcription_model"] else provider_model,
        "transcription_config_version": row["transcription_config_version"] if "transcription_config_version" in row.keys() else None,
        "timestamp_strategy": row["timestamp_strategy"] if "timestamp_strategy" in row.keys() else None,
        "provider_mode": row["provider_mode"] if "provider_mode" in row.keys() else None,
        "provider_request_id": row["provider_request_id"] if "provider_request_id" in row.keys() else None,
        "timing_source_summary": json.dumps(timing_summary),
        "pipeline_options": json.dumps(pipeline_options),
        "media_duration_seconds": row["media_duration_seconds"] if "media_duration_seconds" in row.keys() else None,
        "status": status,
        "progress": max(-1, min(100, int(row["progress"] or 0))),
        "word_count": sum(len(item.get("words") or []) for item in (segments or []) if isinstance(item, dict)),
        "caption_count": len(segments or []),
        "queued_at": row["created_at"],
        "started_at": row["started_at"] if "started_at" in row.keys() else (row["created_at"] if status not in {"queued"} else None),
        "completed_at": row["completed_at"],
        "cancelled_at": row["completed_at"] if status == "cancelled" else None,
        "retry_count": row["retry_count"] if "retry_count" in row.keys() else 0,
        "sanitized_error_code": type(row["error"]).__name__ if row["error"] else None,
        "sanitized_error_message": sanitize_error(row["error"]),
        "correlation_id": row["correlation_id"] if "correlation_id" in row.keys() else None,
        "retry_of_job_id": row["retry_of_job_id"] if "retry_of_job_id" in row.keys() else None,
        "admin_retry_by": row["admin_retry_by"] if "admin_retry_by" in row.keys() else None,
        "created_at": row["created_at"],
        "updated_at": now,
    }


async def mirror_caption_job(job_id: str) -> None:
    try:
        payload = await caption_payload(job_id)
        if payload:
            await mirror_event("caption_job", job_id, payload)
    except Exception:
        logger.exception(
            "operational_mirror_enqueue_failed event_type=caption_job record_id=%s",
            job_id,
        )


async def export_payload(export_job_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM export_jobs WHERE id = ?", (export_job_id,))
        row = await cursor.fetchone()
    if not row:
        return None
    performance = {}
    if "performance_json" in row.keys() and row["performance_json"]:
        try:
            performance = json.loads(row["performance_json"])
        except (TypeError, json.JSONDecodeError):
            pass
    immutable_input = {}
    if "immutable_input_json" in row.keys() and row["immutable_input_json"]:
        try:
            immutable_input = json.loads(row["immutable_input_json"])
        except (TypeError, json.JSONDecodeError):
            pass
    status = row["status"]
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "project_id": row["project_id"] if "project_id" in row.keys() else row["source_job_id"],
        "source_caption_job_id": row["source_job_id"],
        "mode": row["mode"] if "mode" in row.keys() else None,
        "status": status,
        "stage": row["stage"],
        "progress": max(-1, min(100, int(row["progress"] or 0))),
        "width": row["width"],
        "height": row["height"],
        "fps": row["fps"],
        "duration_seconds": row["duration"],
        "output_size_bytes": row["bytes"],
        "render_time_seconds": performance.get("renderTimeSeconds"),
        "queued_at": row["created_at"],
        "started_at": row["created_at"] if status not in {"queued"} else None,
        "completed_at": row["updated_at"] if status in {"completed", "failed", "cancelled", "expired"} else None,
        "cancelled_at": row["updated_at"] if status == "cancelled" else None,
        "retry_count": row["retry_count"] if "retry_count" in row.keys() else 0,
        "error_class": row["stage"] if row["error"] else None,
        "sanitized_error_message": sanitize_error(row["error"]),
        "output_expiry": row["expires_at"],
        "correlation_id": row["correlation_id"] if "correlation_id" in row.keys() else None,
        "retry_of_export_id": row["retry_of_export_id"] if "retry_of_export_id" in row.keys() else None,
        "admin_retry_by": row["admin_retry_by"] if "admin_retry_by" in row.keys() else None,
        "immutable_input": json.dumps(immutable_input),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


async def mirror_export_job(export_job_id: str) -> None:
    try:
        payload = await export_payload(export_job_id)
        if payload:
            await mirror_event("export_job", export_job_id, payload)
    except Exception:
        logger.exception(
            "operational_mirror_enqueue_failed event_type=export_job record_id=%s",
            export_job_id,
        )


async def mirror_deleted_project(payload: dict[str, Any]) -> str:
    return await mirror_event(
        "deleted_project", str(payload["project_id"]), payload
    )


async def flush_operational_outbox(
    limit: int = 100, *, event_id: str | None = None
) -> dict[str, int]:
    delivered = failed = 0
    async with runtime_db(path=DB_PATH, row_factory=True) as db:
        if event_id:
            cursor = await db.execute(
                """
                SELECT * FROM operational_outbox
                WHERE event_id = ? AND next_attempt_at <= CURRENT_TIMESTAMP
                LIMIT 1
                """,
                (event_id,),
            )
        else:
            cursor = await db.execute(
                """
                SELECT * FROM operational_outbox
                WHERE next_attempt_at <= CURRENT_TIMESTAMP
                ORDER BY created_at LIMIT ?
                """,
                (limit,),
            )
        rows = await cursor.fetchall()
    for row in rows:
        try:
            await deliver_event(row["event_type"], json.loads(row["payload_json"]))
            async with runtime_db(path=DB_PATH) as db:
                await db.execute("DELETE FROM operational_outbox WHERE event_id = ?", (row["event_id"],))
                await db.commit()
            delivered += 1
        except Exception as exc:
            attempts = int(row["attempts"] or 0) + 1
            delay_seconds = min(3600, 2 ** min(attempts, 10))
            async with runtime_db(path=DB_PATH) as db:
                await db.execute(
                    """
                    UPDATE operational_outbox
                    SET attempts = ?, last_error = ?,
                        next_attempt_at = datetime('now', ?)
                    WHERE event_id = ?
                    """,
                    (attempts, sanitize_error(exc), f"+{delay_seconds} seconds", row["event_id"]),
                )
                await db.commit()
            failed += 1
    return {"delivered": delivered, "failed": failed, "remaining": len(rows) - delivered}


async def reconcile_runtime_jobs() -> dict[str, int]:
    captions = exports = 0
    async with aiosqlite.connect(str(DB_PATH)) as db:
        caption_ids = [row[0] for row in await (await db.execute("SELECT id FROM jobs")).fetchall()]
        export_ids = [row[0] for row in await (await db.execute("SELECT id FROM export_jobs")).fetchall()]
    for job_id in caption_ids:
        await mirror_caption_job(job_id)
        captions += 1
    for export_id in export_ids:
        await mirror_export_job(export_id)
        exports += 1
    flush = await flush_operational_outbox(500)
    return {"captionJobs": captions, "exportJobs": exports, **flush}


async def operational_mirror_loop() -> None:
    _stop_event.clear()
    while not _stop_event.is_set():
        try:
            await flush_operational_outbox()
        except Exception:
            logger.exception("operational_outbox_flush_failed")
        try:
            await asyncio.wait_for(_stop_event.wait(), timeout=15)
        except asyncio.TimeoutError:
            pass


async def stop_operational_mirror() -> None:
    _stop_event.set()
