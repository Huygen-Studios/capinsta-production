import asyncio

import aiosqlite

from server import pipeline_runner


CREATE_JOBS_SQL = """
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    filename TEXT NOT NULL,
    target_lang TEXT,
    created_at TEXT,
    completed_at TEXT,
    error TEXT,
    vtt_content TEXT,
    srt_content TEXT,
    segments_json TEXT,
    transcript_json TEXT,
    heartbeat_at TEXT,
    updated_at TEXT,
    started_at TEXT,
    message TEXT,
    current_provider TEXT,
    current_chunk INTEGER,
    total_chunks INTEGER
)
"""


def test_job_progress_is_monotonic_and_heartbeat_updates(tmp_path, monkeypatch):
    db_path = tmp_path / "jobs.sqlite"

    async def setup():
        async with aiosqlite.connect(db_path) as db:
            await db.execute(CREATE_JOBS_SQL)
            await db.execute(
                """
                INSERT INTO jobs
                  (id, status, progress, filename, target_lang, created_at, heartbeat_at, updated_at)
                VALUES
                  ('job-1', 'transcribing', 42, 'sample.mp4', 'english',
                   '2026-06-23T00:00:00+00:00', '2026-06-23T00:00:00+00:00',
                   '2026-06-23T00:00:00+00:00')
                """
            )
            await db.commit()

    async def read_row():
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM jobs WHERE id = 'job-1'")
            return await cursor.fetchone()

    async def no_mirror(_job_id):
        return None

    monkeypatch.setattr(pipeline_runner, "DB_PATH", db_path)
    monkeypatch.setattr(pipeline_runner, "mirror_caption_job", no_mirror)

    asyncio.run(setup())
    asyncio.run(
        pipeline_runner.update_job_status(
            "job-1",
            "transcribing",
            18,
            message="Transcribing chunk 2 of 2 with Gemini.",
        )
    )
    row = asyncio.run(read_row())

    assert row["progress"] == 42
    assert row["message"] == "Transcribing chunk 2 of 2 with Gemini."
    assert row["current_provider"] == "gemini"
    assert row["current_chunk"] == 2
    assert row["total_chunks"] == 2
    assert row["heartbeat_at"] != "2026-06-23T00:00:00+00:00"

    assert asyncio.run(pipeline_runner.update_job_heartbeat("job-1")) is True
    heartbeat_row = asyncio.run(read_row())

    assert heartbeat_row["progress"] == 42
    assert heartbeat_row["heartbeat_at"] >= row["heartbeat_at"]
