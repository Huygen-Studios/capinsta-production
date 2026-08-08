import asyncio
from datetime import datetime, timedelta, timezone

import aiosqlite
import pytest
from fastapi import HTTPException

from server import project_cleanup
from server.api import jobs as jobs_api


def _iso(value: datetime) -> str:
    return value.isoformat()


async def _create_test_db(path):
    async with aiosqlite.connect(str(path)) as db:
        await db.executescript(
            """
            CREATE TABLE jobs (
                id TEXT PRIMARY KEY, status TEXT, filename TEXT, created_at TEXT,
                last_seen_at TEXT, expires_at TEXT, deleted_at TEXT, delete_reason TEXT
            );
            CREATE TABLE export_jobs (
                id TEXT PRIMARY KEY, source_job_id TEXT, status TEXT,
                output_path TEXT, created_at TEXT, updated_at TEXT,
                expires_at TEXT, deleted_at TEXT, delete_reason TEXT
            );
            """
        )
        await db.commit()


def test_cleanup_expires_terminal_project_and_removes_files(tmp_path, monkeypatch):
    db_path = tmp_path / "jobs.sqlite"
    upload_dir = tmp_path / "uploads"
    export_dir = tmp_path / "exports"
    cache_dir = tmp_path / "cache"
    temp_dir = tmp_path / "runtime"
    for directory in (upload_dir, export_dir, cache_dir, temp_dir):
        directory.mkdir()
    monkeypatch.setattr(project_cleanup, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(project_cleanup, "EXPORT_DIR", export_dir)
    monkeypatch.setattr(project_cleanup, "CACHE_DIR", cache_dir)
    monkeypatch.setattr(project_cleanup, "TEMP_DIR", temp_dir)

    now = datetime.now(timezone.utc)
    job_id = "expired-project"
    source = upload_dir / f"{job_id}_source.mp4"
    output = export_dir / "render-output.mp4"
    cache = cache_dir / f"captions-{job_id}.json"
    source.write_bytes(b"source")
    output.write_bytes(b"export")
    cache.write_text("cache")

    async def arrange_and_run():
        await _create_test_db(db_path)
        async with aiosqlite.connect(str(db_path)) as db:
            await db.execute(
                "INSERT INTO jobs VALUES (?, 'completed', 'source.mp4', ?, ?, ?, NULL, NULL)",
                (job_id, _iso(now - timedelta(minutes=30)), _iso(now - timedelta(minutes=20)), _iso(now - timedelta(minutes=5))),
            )
            await db.execute(
                "INSERT INTO export_jobs VALUES ('export-1', ?, 'completed', ?, ?, ?, ?, NULL, NULL)",
                (job_id, str(output), _iso(now), _iso(now), _iso(now - timedelta(minutes=5))),
            )
            await db.commit()
        result = await project_cleanup.cleanup_expired_projects(db_path=db_path, now=now)
        async with aiosqlite.connect(str(db_path)) as db:
            db.row_factory = aiosqlite.Row
            job = await (await db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))).fetchone()
            export = await (await db.execute("SELECT * FROM export_jobs WHERE id = 'export-1'" )).fetchone()
        return result, job, export

    (projects, files), job, export = asyncio.run(arrange_and_run())
    assert projects == 1
    assert files == 3
    assert job["status"] == "expired"
    assert job["delete_reason"] == "inactivity_timeout"
    assert export["status"] == "expired"
    assert not source.exists() and not output.exists() and not cache.exists()


def test_cleanup_never_removes_running_caption_or_export(tmp_path):
    db_path = tmp_path / "jobs.sqlite"
    now = datetime.now(timezone.utc)

    async def arrange_and_run():
        await _create_test_db(db_path)
        async with aiosqlite.connect(str(db_path)) as db:
            for job_id, status in (("caption-running", "transcribing"), ("export-running", "completed")):
                await db.execute(
                    "INSERT INTO jobs VALUES (?, ?, 'source.mp4', ?, ?, ?, NULL, NULL)",
                    (job_id, status, _iso(now - timedelta(minutes=30)), _iso(now - timedelta(minutes=20)), _iso(now - timedelta(minutes=5))),
                )
            await db.execute(
                "INSERT INTO export_jobs VALUES ('export-2', 'export-running', 'running', NULL, ?, ?, ?, NULL, NULL)",
                (_iso(now), _iso(now), _iso(now - timedelta(minutes=5))),
            )
            await db.commit()
        return await project_cleanup.cleanup_expired_projects(db_path=db_path, now=now)

    assert asyncio.run(arrange_and_run()) == (0, 0)


def test_heartbeat_renews_job_and_related_export(tmp_path, monkeypatch):
    db_path = tmp_path / "jobs.sqlite"
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(project_cleanup, "PROJECT_INACTIVITY_TTL_MINUTES", 15)

    async def arrange_and_run():
        await _create_test_db(db_path)
        async with aiosqlite.connect(str(db_path)) as db:
            db.row_factory = aiosqlite.Row
            await db.execute(
                "INSERT INTO jobs VALUES ('heartbeat-job', 'completed', 'source.mp4', ?, ?, ?, NULL, NULL)",
                (_iso(now - timedelta(minutes=10)), _iso(now - timedelta(minutes=10)), _iso(now + timedelta(minutes=5))),
            )
            await db.execute(
                "INSERT INTO export_jobs VALUES ('export-3', 'heartbeat-job', 'completed', NULL, ?, ?, ?, NULL, NULL)",
                (_iso(now), _iso(now), _iso(now + timedelta(minutes=5))),
            )
            await db.commit()
            lease = await project_cleanup.heartbeat_project("heartbeat-job", db)
            export = await (await db.execute("SELECT expires_at FROM export_jobs WHERE id = 'export-3'" )).fetchone()
        return lease, export["expires_at"]

    lease, export_expiry = asyncio.run(arrange_and_run())
    assert export_expiry == lease["expires_at"]
    assert project_cleanup.parse_utc(lease["expires_at"]) > now + timedelta(minutes=14)


def test_expired_job_and_video_endpoints_return_gone(tmp_path, monkeypatch):
    db_path = tmp_path / "jobs.sqlite"
    now = datetime.now(timezone.utc)

    async def get_test_job(db, job_id):
        return await (await db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))).fetchone()

    monkeypatch.setattr(jobs_api, "get_owned_job", get_test_job)

    async def arrange_and_call():
        await _create_test_db(db_path)
        async with aiosqlite.connect(str(db_path)) as db:
            db.row_factory = aiosqlite.Row
            await db.execute(
                "INSERT INTO jobs VALUES ('gone-job', 'expired', 'source.mp4', ?, ?, ?, ?, 'inactivity_timeout')",
                (_iso(now - timedelta(minutes=30)), _iso(now - timedelta(minutes=20)), _iso(now - timedelta(minutes=5)), _iso(now)),
            )
            await db.commit()
            errors = []
            for endpoint in (jobs_api.get_job, jobs_api.get_video):
                try:
                    await endpoint("gone-job", db)
                except HTTPException as exc:
                    errors.append(exc)
            return errors

    errors = asyncio.run(arrange_and_call())
    assert [error.status_code for error in errors] == [410, 410]
    assert all("expired after 15 minutes" in error.detail for error in errors)
