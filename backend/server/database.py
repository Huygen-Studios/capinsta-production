import os
from contextlib import asynccontextmanager
import os

import aiosqlite

from .settings import DB_PATH, ensure_runtime_dirs

def _sqlite_busy_timeout_ms() -> int:
    try:
        return max(1_000, int(os.getenv("SQLITE_BUSY_TIMEOUT_MS", "15000")))
    except ValueError:
        return 15_000


SQLITE_BUSY_TIMEOUT_MS = _sqlite_busy_timeout_ms()


async def connect_runtime_db(
    *,
    path=None,
    row_factory: bool = False,
) -> aiosqlite.Connection:
    database_path = DB_PATH if path is None else path
    db = await aiosqlite.connect(
        str(database_path),
        timeout=SQLITE_BUSY_TIMEOUT_MS / 1000,
    )
    await db.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    await db.execute("PRAGMA foreign_keys = ON")
    if row_factory:
        db.row_factory = aiosqlite.Row
    return db


@asynccontextmanager
async def runtime_db(*, path=None, row_factory: bool = False):
    db = await connect_runtime_db(path=path, row_factory=row_factory)
    try:
        yield db
    finally:
        await db.close()


async def init_db():
    # Ensure storage folder exists
    ensure_runtime_dirs()
    
    async with runtime_db() as db:
        await db.execute("PRAGMA journal_mode = WAL")
        await db.execute("PRAGMA synchronous = NORMAL")
        await db.execute('''
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                progress INTEGER DEFAULT 0,
                filename TEXT NOT NULL,
                target_lang TEXT DEFAULT 'auto_mixed_indian',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                error TEXT,
                vtt_content TEXT,
                srt_content TEXT,
                segments_json TEXT,
                transcript_json TEXT
                ,last_seen_at TEXT
                ,expires_at TEXT
                ,deleted_at TEXT
                ,delete_reason TEXT
                ,user_id TEXT
            )
        ''')
        await db.commit()

        # Migrate: add segments_json column if missing (for existing DBs)
        try:
            await db.execute("ALTER TABLE jobs ADD COLUMN segments_json TEXT")
            await db.commit()
        except Exception:
            pass  # Column already exists

        try:
            await db.execute("ALTER TABLE jobs ADD COLUMN transcript_json TEXT")
            await db.commit()
        except Exception:
            pass  # Column already exists

        for column in ("last_seen_at TEXT", "expires_at TEXT", "deleted_at TEXT", "delete_reason TEXT", "user_id TEXT"):
            try:
                await db.execute(f"ALTER TABLE jobs ADD COLUMN {column}")
                await db.commit()
            except Exception:
                pass

        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS media_assets (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                original_name TEXT NOT NULL,
                mime_type TEXT,
                size_bytes INTEGER NOT NULL,
                storage_path TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ready',
                created_at TEXT NOT NULL,
                last_accessed_at TEXT NOT NULL,
                deleted_at TEXT,
                validation_status TEXT,
                validation_metadata_json TEXT,
                validation_checked_at TEXT,
                media_duration_seconds REAL
            )
            """
        )
        for column in (
            "validation_status TEXT",
            "validation_metadata_json TEXT",
            "validation_checked_at TEXT",
            "media_duration_seconds REAL",
        ):
            try:
                await db.execute(f"ALTER TABLE media_assets ADD COLUMN {column}")
                await db.commit()
            except Exception:
                pass
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_media_assets_project_owner
            ON media_assets (project_id, user_id, deleted_at)
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS project_deletions (
                project_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                status TEXT NOT NULL,
                requested_at TEXT NOT NULL,
                completed_at TEXT,
                error_code TEXT,
                retained_metadata_json TEXT NOT NULL DEFAULT '{}'
            )
            """
        )

        await db.execute('''
            CREATE TABLE IF NOT EXISTS export_jobs (
                id TEXT PRIMARY KEY,
                source_job_id TEXT NOT NULL,
                status TEXT NOT NULL,
                stage TEXT NOT NULL,
                progress INTEGER DEFAULT 0,
                message TEXT DEFAULT '',
                error TEXT,
                download_url TEXT,
                filename TEXT,
                output_path TEXT,
                bytes INTEGER,
                duration REAL,
                width INTEGER,
                height INTEGER,
                fps INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
                ,expires_at TEXT
                ,deleted_at TEXT
                ,delete_reason TEXT
                ,user_id TEXT
            )
        ''')
        await db.commit()

        for column in ("expires_at TEXT", "deleted_at TEXT", "delete_reason TEXT", "user_id TEXT"):
            try:
                await db.execute(f"ALTER TABLE export_jobs ADD COLUMN {column}")
                await db.commit()
            except Exception:
                pass

        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_jobs_user_id_created_at ON jobs (user_id, created_at)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_jobs_user_created_id ON jobs (user_id, created_at DESC, id DESC)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_export_jobs_user_id_created_at ON export_jobs (user_id, created_at)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_export_jobs_user_created_id ON export_jobs (user_id, created_at DESC, id DESC)"
        )
        await db.execute('''
            CREATE TABLE IF NOT EXISTS operational_outbox (
                event_id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                record_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_operational_outbox_retry ON operational_outbox (next_attempt_at, created_at)"
        )
        await db.execute('''
            CREATE TABLE IF NOT EXISTS admin_idempotency (
                idempotency_key TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                target_id TEXT NOT NULL,
                result_json TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        for column in (
            "project_id TEXT", "media_duration_seconds REAL", "started_at TEXT",
            "retry_count INTEGER DEFAULT 0", "retry_of_job_id TEXT",
            "admin_retry_by TEXT", "correlation_id TEXT", "media_asset_id TEXT",
            "message TEXT", "heartbeat_at TEXT", "updated_at TEXT",
            "current_provider TEXT", "current_chunk INTEGER", "total_chunks INTEGER",
            "transcription_provider TEXT", "transcription_model TEXT",
            "transcription_config_version INTEGER", "timestamp_strategy TEXT",
            "provider_mode TEXT", "provider_request_id TEXT",
            "timing_source_summary_json TEXT",
            "pipeline_options_json TEXT",
            "transcription_config_snapshot_json TEXT",
            "idempotency_key TEXT",
            "immutable_request_json TEXT",
            "metrics_json TEXT",
            "source_in_ms INTEGER",
            "source_out_ms INTEGER",
            "timeline_offset_ms INTEGER",
        ):
            try:
                await db.execute(f"ALTER TABLE jobs ADD COLUMN {column}")
            except Exception:
                pass
        for column in (
            "project_id TEXT", "mode TEXT", "retry_count INTEGER DEFAULT 0",
            "retry_of_export_id TEXT", "admin_retry_by TEXT", "correlation_id TEXT",
            "immutable_input_json TEXT", "performance_json TEXT",
            "idempotency_key TEXT"
        ):
            try:
                await db.execute(f"ALTER TABLE export_jobs ADD COLUMN {column}")
            except Exception:
                pass
        await db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_export_jobs_user_idempotency
            ON export_jobs (user_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            """
        )
        await db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_user_idempotency
            ON jobs (user_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS caption_artifacts (
                id TEXT PRIMARY KEY,
                media_asset_id TEXT NOT NULL,
                audio_fingerprint TEXT NOT NULL,
                language_mode TEXT NOT NULL,
                output_language TEXT NOT NULL,
                preset TEXT NOT NULL,
                source_in_ms INTEGER,
                source_out_ms INTEGER,
                timeline_offset_ms INTEGER,
                segments_json TEXT NOT NULL,
                transcript_json TEXT NOT NULL,
                srt_content TEXT,
                vtt_content TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        for col in (
            "srt_content TEXT", "vtt_content TEXT",
            "source_in_ms INTEGER", "source_out_ms INTEGER",
            "timeline_offset_ms INTEGER"
        ):
            try:
                await db.execute(f"ALTER TABLE caption_artifacts ADD COLUMN {col}")
                await db.commit()
            except Exception:
                pass
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_caption_artifacts_lookup
            ON caption_artifacts (
                media_asset_id, audio_fingerprint, language_mode, output_language, preset,
                source_in_ms, source_out_ms, timeline_offset_ms
            )
            """
        )
        await db.commit()

async def get_db():
    async with runtime_db(row_factory=True) as db:
        yield db
