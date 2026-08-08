import asyncio

import aiosqlite
import pytest
from fastapi import HTTPException
from starlette.requests import Request

import server.database as database
from server.api import export_jobs, jobs as jobs_api
from server.auth import AuthenticatedUser, reset_current_user, set_current_user
from server.pagination import decode_cursor, encode_cursor


def _request(path: str, query: str = "") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "query_string": query.encode("utf-8"),
            "headers": [],
        }
    )


def test_cursor_is_signed_and_rejects_tampering():
    cursor = encode_cursor(created_at="2026-07-01T00:00:00Z", item_id="job-1")

    assert decode_cursor(cursor) == ("2026-07-01T00:00:00Z", "job-1")
    with pytest.raises(HTTPException) as error:
        decode_cursor(f"{cursor[:-1]}x")

    assert error.value.status_code == 400


def test_caption_job_v1_cursor_pagination_is_stable_and_tenant_safe():
    async def run():
        async with aiosqlite.connect(":memory:") as db:
            db.row_factory = aiosqlite.Row
            await db.execute(
                """
                CREATE TABLE jobs (
                    id TEXT,
                    status TEXT,
                    progress INTEGER,
                    filename TEXT,
                    target_lang TEXT,
                    error TEXT,
                    created_at TEXT,
                    completed_at TEXT,
                    user_id TEXT
                )
                """
            )
            rows = [
                ("job-3", "user-1", "2026-07-01T00:00:03Z"),
                ("job-2", "user-1", "2026-07-01T00:00:02Z"),
                ("job-1", "user-1", "2026-07-01T00:00:01Z"),
                ("other-1", "user-2", "2026-07-01T00:00:04Z"),
            ]
            for job_id, user_id, created_at in rows:
                await db.execute(
                    "INSERT INTO jobs VALUES (?, 'completed', 100, 'video.mp4', 'english', NULL, ?, NULL, ?)",
                    (job_id, created_at, user_id),
                )
            await db.commit()
            context = set_current_user(AuthenticatedUser(id="user-1"))
            try:
                first = await jobs_api.list_jobs(_request("/api/v1/jobs", "limit=2"), db, limit=2, cursor=None)
                second = await jobs_api.list_jobs(
                    _request("/api/v1/jobs", f"limit=2&cursor={first['pagination']['nextCursor']}"),
                    db,
                    limit=2,
                    cursor=first["pagination"]["nextCursor"],
                )
                legacy = await jobs_api.list_jobs(_request("/api/jobs"), db, limit=None, cursor=None)
            finally:
                reset_current_user(context)

        assert [item["job_id"] for item in first["items"]] == ["job-3", "job-2"]
        assert first["pagination"]["hasMore"] is True
        assert [item["job_id"] for item in second["items"]] == ["job-1"]
        assert second["pagination"]["hasMore"] is False
        assert all(item["job_id"] != "other-1" for item in first["items"] + second["items"])
        assert isinstance(legacy, list)
        assert [item.job_id for item in legacy] == ["job-3", "job-2", "job-1"]

    asyncio.run(run())


def test_export_job_v1_cursor_pagination_is_stable_and_tenant_safe(tmp_path, monkeypatch):
    async def run():
        db_path = tmp_path / "runtime.sqlite"
        monkeypatch.setattr(database, "DB_PATH", db_path)
        monkeypatch.setattr(export_jobs, "DB_PATH", db_path)
        await database.init_db()
        async with aiosqlite.connect(db_path) as db:
            rows = [
                ("export-3", "user-1", "2026-07-01T00:00:03Z"),
                ("export-2", "user-1", "2026-07-01T00:00:02Z"),
                ("export-1", "user-1", "2026-07-01T00:00:01Z"),
                ("other-1", "user-2", "2026-07-01T00:00:04Z"),
            ]
            for export_id, user_id, created_at in rows:
                await db.execute(
                    """
                    INSERT INTO export_jobs
                      (id, source_job_id, status, stage, progress, created_at, updated_at, user_id)
                    VALUES (?, 'job-1', 'completed', 'done', 100, ?, ?, ?)
                    """,
                    (export_id, created_at, created_at, user_id),
                )
            await db.commit()
        context = set_current_user(AuthenticatedUser(id="user-1"))
        try:
            first = await export_jobs.list_export_jobs(_request("/api/v1/export/jobs", "limit=2"), limit=2, cursor=None)
            second = await export_jobs.list_export_jobs(
                _request("/api/v1/export/jobs", f"limit=2&cursor={first['pagination']['nextCursor']}"),
                limit=2,
                cursor=first["pagination"]["nextCursor"],
            )
            legacy = await export_jobs.list_export_jobs(_request("/api/export/jobs"), limit=None, cursor=None)
        finally:
            reset_current_user(context)

        assert [item["jobId"] for item in first["items"]] == ["export-3", "export-2"]
        assert first["pagination"]["hasMore"] is True
        assert [item["jobId"] for item in second["items"]] == ["export-1"]
        assert second["pagination"]["hasMore"] is False
        assert all(item["jobId"] != "other-1" for item in first["items"] + second["items"])
        assert isinstance(legacy, list)
        assert [item["jobId"] for item in legacy] == ["export-3", "export-2", "export-1"]

    asyncio.run(run())
