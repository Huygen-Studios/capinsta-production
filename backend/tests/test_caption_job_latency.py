import asyncio
import json
from datetime import datetime, timedelta, timezone

import aiosqlite
import pytest
from fastapi import HTTPException

import ai_pipeline.transcriber as transcriber
import server.caption_queue as caption_queue
import server.database as database
from server.api import jobs as jobs_api
from server.api import media_assets
from server.auth import AuthenticatedUser, reset_current_user, set_current_user


class RequestStub:
    headers = {"x-correlation-id": "corr-test"}


class SnapshotStub:
    provider = "local-test"
    model = "unit"
    version = 1
    timestamp_strategy = "provider"
    provider_mode = "unit"

    def to_dict(self):
        return {
            "provider": self.provider,
            "model": self.model,
            "version": self.version,
            "timestamp_strategy": self.timestamp_strategy,
            "provider_mode": self.provider_mode,
        }


async def _noop_async(*_args, **_kwargs):
    return None


def test_media_asset_job_creation_reuses_validation_metadata_without_ffprobe(tmp_path, monkeypatch):
    async def run():
        db_path = tmp_path / "runtime.sqlite"
        media_root = tmp_path / "media"
        monkeypatch.setattr(database, "DB_PATH", db_path)
        monkeypatch.setattr(jobs_api, "DB_PATH", db_path)
        monkeypatch.setattr(media_assets, "MEDIA_DIR", media_root)
        await database.init_db()

        asset_path = media_assets._asset_path("user-1", "project-1", "asset-1")
        asset_path.parent.mkdir(parents=True)
        asset_path.write_bytes(b"not a real mp4; metadata should make this fast path skip probing")
        metadata = {
            "status": "validated",
            "kind": "video",
            "durationSeconds": 12.5,
            "container": "mov,mp4,m4a,3gp,3g2,mj2",
            "streams": [
                {"codecType": "video", "codecName": "h264", "width": 720, "height": 1280},
                {"codecType": "audio", "codecName": "aac"},
            ],
        }
        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                """
                INSERT INTO media_assets (
                    id, project_id, user_id, original_name, mime_type, size_bytes,
                    storage_path, status, created_at, last_accessed_at, deleted_at,
                    validation_status, validation_metadata_json, validation_checked_at,
                    media_duration_seconds
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, NULL, ?, ?, ?, ?)
                """,
                (
                    "asset-1",
                    "project-1",
                    "user-1",
                    "clip.mp4",
                    "video/mp4",
                    64,
                    str(asset_path),
                    "2026-07-01T00:00:00+00:00",
                    "2026-07-01T00:00:00+00:00",
                    "validated",
                    json.dumps(metadata),
                    "2026-07-01T00:00:00+00:00",
                    12.5,
                ),
            )
            await db.commit()

        async def fail_probe(*_args, **_kwargs):
            raise AssertionError("ffprobe fallback should not run for validated media assets")

        async def fake_enqueue(**kwargs):
            return caption_queue.CaptionQueueResult(
                adapter="test",
                job_id=kwargs["job_id"],
                worker_started=False,
                active_workers=0,
                queued_jobs=1,
            )

        monkeypatch.setattr(jobs_api, "require_feature", _noop_async)
        monkeypatch.setattr(jobs_api, "enforce_caption_quota", _noop_async)
        monkeypatch.setattr(jobs_api, "assert_transcription_available", lambda: SnapshotStub())
        monkeypatch.setattr(transcriber, "validate_transcription_config", lambda *_args, **_kwargs: None)
        monkeypatch.setattr(jobs_api, "_media_duration_seconds", fail_probe)
        monkeypatch.setattr(jobs_api, "validate_media_file_contents", fail_probe)
        monkeypatch.setattr(jobs_api, "enqueue_caption_job", fake_enqueue)
        monkeypatch.setattr(jobs_api, "mirror_caption_job", _noop_async)

        context = set_current_user(AuthenticatedUser(id="user-1"))
        try:
            response = await jobs_api.create_job(
                RequestStub(),
                audioLanguage="english",
                captionOutput="original",
                project_id="project-1",
                media_asset_id="asset-1",
                file=None,
            )
        finally:
            reset_current_user(context)

        assert response.status == "queued"
        async with aiosqlite.connect(db_path) as db:
            row = await (await db.execute("SELECT media_duration_seconds FROM jobs")).fetchone()
        assert row[0] == 12.5

    asyncio.run(run())


def test_caption_job_enqueue_failure_returns_controlled_503(tmp_path, monkeypatch):
    async def run():
        db_path = tmp_path / "runtime.sqlite"
        media_root = tmp_path / "media"
        monkeypatch.setattr(database, "DB_PATH", db_path)
        monkeypatch.setattr(jobs_api, "DB_PATH", db_path)
        monkeypatch.setattr(media_assets, "MEDIA_DIR", media_root)
        await database.init_db()

        asset_path = media_assets._asset_path("user-1", "project-1", "asset-1")
        asset_path.parent.mkdir(parents=True)
        asset_path.write_bytes(b"fake")
        metadata = {"status": "validated", "kind": "video", "durationSeconds": 5.0}
        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                """
                INSERT INTO media_assets (
                    id, project_id, user_id, original_name, mime_type, size_bytes,
                    storage_path, status, created_at, last_accessed_at, deleted_at,
                    validation_status, validation_metadata_json, validation_checked_at,
                    media_duration_seconds
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, NULL, ?, ?, ?, ?)
                """,
                (
                    "asset-1", "project-1", "user-1", "clip.mp4", "video/mp4", 4,
                    str(asset_path), "2026-07-01T00:00:00+00:00",
                    "2026-07-01T00:00:00+00:00", "validated",
                    json.dumps(metadata), "2026-07-01T00:00:00+00:00", 5.0,
                ),
            )
            await db.commit()

        async def unavailable(**_kwargs):
            raise caption_queue.CaptionQueueUnavailable("queue down")

        monkeypatch.setattr(jobs_api, "require_feature", _noop_async)
        monkeypatch.setattr(jobs_api, "enforce_caption_quota", _noop_async)
        monkeypatch.setattr(jobs_api, "assert_transcription_available", lambda: SnapshotStub())
        monkeypatch.setattr(transcriber, "validate_transcription_config", lambda *_args, **_kwargs: None)
        monkeypatch.setattr(jobs_api, "enqueue_caption_job", unavailable)
        monkeypatch.setattr(jobs_api, "mirror_caption_job", _noop_async)

        context = set_current_user(AuthenticatedUser(id="user-1"))
        try:
            with pytest.raises(HTTPException) as error:
                await jobs_api.create_job(
                    RequestStub(),
                    audioLanguage="english",
                    captionOutput="original",
                    project_id="project-1",
                    media_asset_id="asset-1",
                    file=None,
                )
        finally:
            reset_current_user(context)

        assert error.value.status_code == 503
        assert error.value.detail["code"] == "caption_queue_unavailable"
        async with aiosqlite.connect(db_path) as db:
            row = await (await db.execute("SELECT status, error FROM jobs")).fetchone()
        assert row[0] == "failed"
        assert row[1] == "queue down"

    asyncio.run(run())


def test_queue_overload_fails_before_starting_local_worker(tmp_path, monkeypatch):
    async def run():
        db_path = tmp_path / "runtime.sqlite"
        monkeypatch.setattr(caption_queue, "DB_PATH", db_path)
        monkeypatch.setenv("CAPTION_QUEUE_MODE", "local")
        monkeypatch.setenv("CAPTION_QUEUE_MAX_DEPTH", "1")
        await database.init_db()
        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                "INSERT INTO jobs (id, status, filename, target_lang, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("existing", "queued", "a.mp4", "english", "user-1", "2026-07-01T00:00:00+00:00"),
            )
            await db.execute(
                "INSERT INTO jobs (id, status, filename, target_lang, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("current", "queued", "b.mp4", "english", "user-1", "2026-07-01T00:00:01+00:00"),
            )
            await db.commit()

        def should_not_start(**_kwargs):
            raise AssertionError("overloaded queue must not start worker")

        monkeypatch.setattr(caption_queue, "start_pipeline_worker", should_not_start)
        with pytest.raises(caption_queue.CaptionQueueOverloaded):
            await caption_queue.enqueue_caption_job(
                job_id="current",
                user_id="user-1",
                file_path="b.mp4",
                language_mode="english",
                caption_output="original",
                transcription_config_snapshot={},
            )

    monkeypatch.setattr(database, "DB_PATH", tmp_path / "runtime.sqlite")
    asyncio.run(run())


def test_worker_lease_timeout_marks_stale_job_failed(tmp_path, monkeypatch):
    async def run():
        monkeypatch.setenv("CAPTION_QUEUE_LEASE_TIMEOUT_SECONDS", "30")
        monkeypatch.setenv("CAPTION_QUEUE_MAX_RETRIES", "0")
        old = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        async with aiosqlite.connect(":memory:") as db:
            db.row_factory = aiosqlite.Row
            await db.execute(
                """
                CREATE TABLE jobs (
                    id TEXT,
                    status TEXT,
                    progress INTEGER,
                    retry_count INTEGER,
                    heartbeat_at TEXT,
                    updated_at TEXT,
                    created_at TEXT,
                    completed_at TEXT,
                    error TEXT,
                    message TEXT
                )
                """
            )
            await db.execute(
                """
                INSERT INTO jobs
                (id, status, progress, retry_count, heartbeat_at, updated_at, created_at)
                VALUES ('job-1', 'transcribing', 50, 0, ?, ?, ?)
                """,
                (old, old, old),
            )
            await db.commit()

            changed = await caption_queue.reconcile_stale_caption_jobs(db)
            row = await (await db.execute("SELECT status, progress, error FROM jobs WHERE id = 'job-1'")).fetchone()

        assert changed == 1
        assert row["status"] == "failed"
        assert row["progress"] == -1
        assert "lease expired" in row["error"]

    asyncio.run(run())
