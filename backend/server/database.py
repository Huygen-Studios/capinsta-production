import aiosqlite

from .settings import DB_PATH, ensure_runtime_dirs

async def init_db():
    # Ensure storage folder exists
    ensure_runtime_dirs()
    
    async with aiosqlite.connect(str(DB_PATH)) as db:
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
            "CREATE INDEX IF NOT EXISTS idx_export_jobs_user_id_created_at ON export_jobs (user_id, created_at)"
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
            "admin_retry_by TEXT", "correlation_id TEXT"
        ):
            try:
                await db.execute(f"ALTER TABLE jobs ADD COLUMN {column}")
            except Exception:
                pass
        for column in (
            "project_id TEXT", "mode TEXT", "retry_count INTEGER DEFAULT 0",
            "retry_of_export_id TEXT", "admin_retry_by TEXT", "correlation_id TEXT",
            "immutable_input_json TEXT", "performance_json TEXT"
        ):
            try:
                await db.execute(f"ALTER TABLE export_jobs ADD COLUMN {column}")
            except Exception:
                pass
        await db.commit()

async def get_db():
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()
