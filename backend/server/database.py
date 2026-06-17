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
            )
        ''')
        await db.commit()

async def get_db():
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()
