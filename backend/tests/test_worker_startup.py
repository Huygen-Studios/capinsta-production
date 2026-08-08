import asyncio
import sqlite3

from server import worker_startup


def _create_jobs_db(path, job_id="job-1"):
    with sqlite3.connect(path) as db:
        db.execute(
            """
            CREATE TABLE jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                progress INTEGER DEFAULT 0,
                filename TEXT,
                target_lang TEXT,
                error TEXT,
                srt_content TEXT,
                vtt_content TEXT,
                segments_json TEXT,
                transcript_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            )
            """,
        )
        db.execute(
            "INSERT INTO jobs (id, status, filename, target_lang) VALUES (?, 'queued', 'sample.mp4', 'auto_mixed_indian')",
            (job_id,),
        )
        db.commit()


def _load_job(path, job_id="job-1"):
    with sqlite3.connect(path) as db:
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row)


def test_pipeline_runner_import_does_not_fail():
    status = worker_startup.check_pipeline_worker_import()
    assert status["ok"] is True, status.get("error")


def test_missing_dependency_error_is_clear():
    error = ModuleNotFoundError("No module named 'pyaudioop'")
    error.name = "pyaudioop"

    message = worker_startup.format_worker_startup_error(error)

    assert "Caption worker dependency is missing: pyaudioop" in message
    assert "Install backend requirements" in message


def test_worker_startup_failure_marks_queued_job_failed(tmp_path, monkeypatch):
    db_path = tmp_path / "jobs.db"
    _create_jobs_db(db_path)
    monkeypatch.setattr(worker_startup, "DB_PATH", db_path)

    async def broadcast_progress(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        worker_startup.manager,
        "broadcast_progress",
        broadcast_progress,
    )

    asyncio.run(
        worker_startup.mark_job_failed_from_worker_startup(
            job_id="job-1",
            error_message="Caption worker dependency is missing: pyaudioop.",
        ),
    )

    job = _load_job(db_path)
    assert job["status"] == "failed"
    assert job["progress"] == -1
    assert "pyaudioop" in job["error"]
    assert job["completed_at"] is not None


def test_start_pipeline_worker_catches_import_failure(tmp_path, monkeypatch):
    db_path = tmp_path / "jobs.db"
    _create_jobs_db(db_path)
    monkeypatch.setattr(worker_startup, "DB_PATH", db_path)

    def import_pipeline_runner():
        error = ModuleNotFoundError("No module named 'pyaudioop'")
        error.name = "pyaudioop"
        raise error

    async def broadcast_progress(*_args, **_kwargs):
        return None

    monkeypatch.setattr(worker_startup, "import_pipeline_runner", import_pipeline_runner)
    monkeypatch.setattr(
        worker_startup.manager,
        "broadcast_progress",
        broadcast_progress,
    )

    thread = worker_startup.start_pipeline_worker(
        job_id="job-1",
        file_path="sample.mp4",
        language_mode="auto_mixed_indian",
    )
    thread.join(timeout=5)

    job = _load_job(db_path)
    assert job["status"] == "failed"
    assert "pyaudioop" in job["error"]
