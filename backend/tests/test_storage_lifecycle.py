import json
import sqlite3
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from server import project_deletion, storage_pressure, storage_retention
from server.api import export_jobs


def _create_runtime_db(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, status TEXT,
          progress INTEGER, filename TEXT, target_lang TEXT, created_at TEXT,
          started_at TEXT, completed_at TEXT, error TEXT,
          transcript_json TEXT, media_duration_seconds REAL
        );
        CREATE TABLE export_jobs (
          id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, source_job_id TEXT,
          status TEXT, stage TEXT, progress INTEGER, error TEXT,
          output_path TEXT, width INTEGER, height INTEGER, fps INTEGER,
          duration REAL, bytes INTEGER, performance_json TEXT,
          created_at TEXT, updated_at TEXT
        );
        CREATE TABLE media_assets (
          id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, size_bytes INTEGER,
          storage_path TEXT, deleted_at TEXT
        );
        CREATE TABLE project_deletions (
          project_id TEXT PRIMARY KEY, user_id TEXT, status TEXT,
          requested_at TEXT, completed_at TEXT, error_code TEXT,
          retained_metadata_json TEXT
        );
        CREATE TABLE operational_outbox (
          event_id TEXT PRIMARY KEY, event_type TEXT, record_id TEXT,
          payload_json TEXT, attempts INTEGER, last_error TEXT,
          created_at TEXT, next_attempt_at TEXT
        );
        """
    )
    connection.commit()
    connection.close()


def test_project_deletion_removes_only_owned_content_and_retains_no_text(
    tmp_path, monkeypatch
):
    async def run():
        db_path = tmp_path / "runtime.sqlite"
        _create_runtime_db(db_path)
        media_dir = tmp_path / "media"
        upload_dir = tmp_path / "uploads"
        export_dir = tmp_path / "exports"
        cache_dir = tmp_path / "cache"
        temp_dir = tmp_path / "temp"
        for directory in (media_dir, upload_dir, export_dir, cache_dir, temp_dir):
            directory.mkdir()

        owned_media = media_dir / "project-a" / "asset-a"
        owned_media.parent.mkdir()
        owned_media.write_bytes(b"owned-video")
        other_media = media_dir / "project-b" / "asset-b"
        other_media.parent.mkdir()
        other_media.write_bytes(b"other-video")
        owned_upload = upload_dir / "job-a_source.mp4"
        owned_upload.write_bytes(b"upload")
        owned_export = export_dir / "export-a.mp4"
        owned_export.write_bytes(b"export")
        logs_dir = temp_dir / "logs"
        logs_dir.mkdir()
        owned_log = logs_dir / "job-a_private-content.jsonl"
        owned_log.write_text("private caption")

        transcript = {
            "provider": {"name": "provider", "model": "model"},
            "segments": [
                {"text": "private caption", "words": [{"word": "secret"}]}
            ],
        }
        connection = sqlite3.connect(db_path)
        connection.execute(
            """
            INSERT INTO jobs VALUES (
              'job-a','project-a','user-a','completed',100,'private.mp4','english',
              '2026-01-01T00:00:00+00:00','2026-01-01T00:00:01+00:00',
              '2026-01-01T00:00:03+00:00',NULL,?,10
            )
            """,
            (json.dumps(transcript),),
        )
        connection.execute(
            """
            INSERT INTO export_jobs VALUES (
              'export-a','project-a','user-a','job-a','completed','completed',100,
              NULL,?,720,1280,24,4.0,6,'{"totalElapsedSeconds":2.5}',
              '2026-01-01T00:00:04+00:00','2026-01-01T00:00:06+00:00'
            )
            """,
            (str(owned_export),),
        )
        connection.execute(
            """
            INSERT INTO media_assets VALUES (
              'asset-a','project-a','user-a',11,?,NULL
            )
            """,
            (str(owned_media),),
        )
        connection.commit()
        connection.close()

        monkeypatch.setattr(project_deletion, "DB_PATH", db_path)
        monkeypatch.setattr(project_deletion, "MEDIA_DIR", media_dir)
        monkeypatch.setattr(project_deletion, "UPLOAD_DIR", upload_dir)
        monkeypatch.setattr(project_deletion, "EXPORT_DIR", export_dir)
        monkeypatch.setattr(project_deletion, "CACHE_DIR", cache_dir)
        monkeypatch.setattr(project_deletion, "TEMP_DIR", temp_dir)
        monkeypatch.setattr(
            project_deletion,
            "cancel_project_exports",
            lambda project_id: _async([]),
        )
        retained = {}

        async def remember(payload):
            retained.update(payload)
            return "deletion-event"

        monkeypatch.setattr(project_deletion, "mirror_deleted_project", remember)
        monkeypatch.setattr(
            project_deletion,
            "flush_operational_outbox",
            lambda limit, **kwargs: _async(
                {"failed": 0, "delivered": 1, "remaining": 0}
            ),
        )

        result = await project_deletion.delete_project_resources(
            "project-a", "user-a"
        )
        assert result["status"] == "completed"
        assert not owned_media.exists()
        assert not owned_upload.exists()
        assert not owned_export.exists()
        assert not owned_log.exists()
        assert other_media.exists()
        serialized = json.dumps(retained)
        assert "private caption" not in serialized
        assert "secret" not in serialized
        assert "private.mp4" not in serialized
        assert retained["caption_word_count"] == 1
        assert retained["caption_chunk_count"] == 1

        repeated = await project_deletion.delete_project_resources(
            "project-a", "user-a"
        )
        assert repeated["status"] == "completed"
        connection = sqlite3.connect(db_path)
        retained_row = connection.execute(
            """
            SELECT retained_metadata_json FROM project_deletions
            WHERE project_id = 'project-a'
            """
        ).fetchone()
        connection.close()
        assert json.loads(retained_row[0])["caption_word_count"] == 1

    asyncio.run(run())


def test_project_deletion_path_traversal_is_rejected(tmp_path):
    async def run():
        with pytest.raises(ValueError):
            await project_deletion.delete_project_resources("../escape", "user-a")

    asyncio.run(run())
    outside = tmp_path / "outside"
    outside.write_text("keep")
    assert project_deletion._remove_path(outside, tmp_path / "approved") == 0
    assert outside.exists()


def test_disk_pressure_rejects_upload_and_export(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_pressure, "TEMP_DIR", tmp_path)
    monkeypatch.setattr(storage_pressure, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(
        storage_pressure.shutil,
        "disk_usage",
        lambda root: SimpleNamespace(total=1000, used=950, free=50),
    )
    monkeypatch.setattr(storage_pressure, "DISK_REJECT_UPLOAD_FREE_BYTES", 100)
    monkeypatch.setattr(storage_pressure, "DISK_CRITICAL_FREE_BYTES", 75)
    with pytest.raises(HTTPException) as upload_error:
        storage_pressure.require_disk_capacity(operation="upload")
    assert upload_error.value.status_code == 507
    with pytest.raises(HTTPException) as export_error:
        storage_pressure.require_disk_capacity(operation="export")
    assert export_error.value.status_code == 507


def test_project_export_cancellation_stops_the_running_task(monkeypatch):
    async def run():
        started = asyncio.Event()

        async def active_export():
            started.set()
            await asyncio.sleep(60)

        async def persist(_job):
            return None

        job = export_jobs.ExportJobStatus(
            id="export-active",
            source_job_id="job-active",
            project_id="project-active",
            user_id="user-a",
            status="running",
            stage="render_video",
            progress=50,
        )
        task = asyncio.create_task(active_export())
        await started.wait()
        export_jobs._jobs[job.id] = job
        export_jobs._export_tasks[job.id] = task
        monkeypatch.setattr(export_jobs, "_persist_job", persist)

        cancelled = await export_jobs.cancel_project_exports("project-active")
        assert cancelled == ["export-active"]
        assert task.cancelled()
        assert job.status == "cancelled"
        assert job.error == "project_deleted"
        export_jobs._jobs.pop(job.id, None)
        export_jobs._export_tasks.pop(job.id, None)

    asyncio.run(run())


def test_expired_orphan_cleanup_preserves_active_files(tmp_path, monkeypatch):
    async def run():
        db_path = tmp_path / "runtime.sqlite"
        connection = sqlite3.connect(db_path)
        connection.executescript(
            """
            CREATE TABLE jobs (
              id TEXT, project_id TEXT, user_id TEXT, status TEXT,
              deleted_at TEXT
            );
            CREATE TABLE export_jobs (id TEXT, status TEXT, output_path TEXT);
            CREATE TABLE media_assets (storage_path TEXT, deleted_at TEXT);
            INSERT INTO jobs VALUES (
              'active-job','project-active','user-a','running',NULL
            );
            """
        )
        connection.commit()
        connection.close()
        upload_dir = tmp_path / "uploads"
        export_dir = tmp_path / "exports"
        media_dir = tmp_path / "media"
        temp_dir = tmp_path / "temp"
        cache_dir = tmp_path / "cache"
        for directory in (upload_dir, export_dir, media_dir, temp_dir, cache_dir):
            directory.mkdir()
        orphan = upload_dir / "orphan.mp4"
        active = upload_dir / "active-job_source.mp4"
        orphan.write_bytes(b"x")
        active.write_bytes(b"x")
        old = (datetime.now(timezone.utc) - timedelta(days=2)).timestamp()
        import os

        os.utime(orphan, (old, old))
        os.utime(active, (old, old))
        for name, value in {
            "DB_PATH": db_path,
            "UPLOAD_DIR": upload_dir,
            "EXPORT_DIR": export_dir,
            "MEDIA_DIR": media_dir,
            "TEMP_DIR": temp_dir,
            "CACHE_DIR": cache_dir,
        }.items():
            monkeypatch.setattr(storage_retention, name, value)
        result = await storage_retention.cleanup_retained_storage()
        assert result["abandonedUploads"] == 1
        assert not orphan.exists()
        assert active.exists()

    asyncio.run(run())


async def _async(value):
    return value
