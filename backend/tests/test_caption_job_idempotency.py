import asyncio
import sqlite3

import aiosqlite
import pytest
from fastapi import HTTPException

import server.database as database
from server.api import jobs as jobs_api
from server.auth import AuthenticatedUser, reset_current_user, set_current_user


def test_caption_job_idempotency_index_prevents_duplicate_user_request(tmp_path, monkeypatch):
    path = tmp_path / "runtime.sqlite"
    monkeypatch.setattr(database, "DB_PATH", path)
    asyncio.run(database.init_db())

    columns = [
        "id",
        "status",
        "filename",
        "target_lang",
        "created_at",
        "user_id",
        "idempotency_key",
    ]
    values = (
        "job-1",
        "queued",
        "video.mp4",
        "english",
        "2026-06-30T00:00:00Z",
        "user-1",
        "request-1",
    )
    with sqlite3.connect(path) as db:
        db.execute(
            f"INSERT INTO jobs ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
            values,
        )
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                f"INSERT INTO jobs ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
                ("job-2", *values[1:]),
            )


def test_caption_job_idempotency_replay_and_conflict():
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
                    user_id TEXT,
                    idempotency_key TEXT,
                    created_at TEXT,
                    immutable_request_json TEXT
                )
                """
            )
            immutable = {
                "project_id": "project-1",
                "media_asset_id": "asset-1",
                "filename": "video.mp4",
                "content_type": "video/mp4",
                "size_bytes": 100,
                "audio_language": "english",
                "caption_output": "original",
                "provider": None,
                "model": None,
                "config_version": None,
                "timestamp_strategy": None,
                "provider_mode": None,
            }
            await db.execute(
                """
                INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "job-1",
                    "queued",
                    0,
                    "video.mp4",
                    "english",
                    "user-1",
                    "idem-1",
                    "2026-06-30T00:00:00Z",
                    jobs_api.json.dumps(immutable, sort_keys=True),
                ),
            )
            await db.commit()
            context = set_current_user(AuthenticatedUser(id="user-1"))
            try:
                replay = await jobs_api._existing_idempotent_job(
                    db,
                    key="idem-1",
                    immutable_request=immutable,
                )
                with pytest.raises(HTTPException) as conflict:
                    await jobs_api._existing_idempotent_job(
                        db,
                        key="idem-1",
                        immutable_request={**immutable, "filename": "other.mp4"},
                    )
            finally:
                reset_current_user(context)

        assert replay is not None
        assert replay["id"] == "job-1"
        assert conflict.value.status_code == 409

    asyncio.run(run())


def test_caption_job_idempotency_key_validation_rejects_unsafe_key():
    class RequestStub:
        headers = {"x-idempotency-key": "bad key with spaces"}

    with pytest.raises(HTTPException) as error:
        jobs_api._idempotency_key_from_request(RequestStub())

    assert error.value.status_code == 400
