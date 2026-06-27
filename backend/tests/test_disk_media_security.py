import asyncio
import sqlite3
from pathlib import Path

import pytest
from fastapi import HTTPException

from server.api import export_jobs
from server.api import media_assets
from server.main import app
from scripts import audit_migrate_disk_storage
from server.storage_paths import (
    path_inside,
    public_download_name,
    resolve_existing_file_inside,
)


def test_resolve_existing_file_inside_accepts_contained_file(tmp_path: Path):
    root = tmp_path / "storage"
    root.mkdir()
    media = root / "user-a" / "project-a" / "asset-a"
    media.parent.mkdir(parents=True)
    media.write_bytes(b"ok")

    resolved = resolve_existing_file_inside(root, media, label="media asset")

    assert resolved == media.resolve()


def test_resolve_existing_file_inside_rejects_path_traversal(tmp_path: Path):
    root = tmp_path / "storage"
    root.mkdir()
    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"not yours")

    with pytest.raises(ValueError):
        resolve_existing_file_inside(root, outside, label="media asset")


def test_resolve_existing_file_inside_rejects_symlink_escape(tmp_path: Path):
    root = tmp_path / "storage"
    root.mkdir()
    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"not yours")
    link = root / "link.mp4"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("symlink creation is unavailable in this environment")

    with pytest.raises(ValueError):
        resolve_existing_file_inside(root, link, label="media asset")


def test_path_inside_rejects_escape_segments(tmp_path: Path):
    root = tmp_path / "storage"
    root.mkdir()

    with pytest.raises(ValueError):
        path_inside(root, "..", "outside.mp4")


def test_media_asset_path_is_user_project_scoped(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(media_assets, "MEDIA_DIR", tmp_path)

    path = media_assets._asset_path("user_a", "project_b", "asset_c")

    assert path == (tmp_path / "user_a" / "project_b" / "asset_c").resolve()


def test_media_asset_path_rejects_malformed_ids(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(media_assets, "MEDIA_DIR", tmp_path)

    with pytest.raises(ValueError):
        media_assets._asset_path("../user", "project", "asset")


def test_legacy_media_asset_path_is_not_servable(monkeypatch, tmp_path: Path):
    media_root = tmp_path / "media"
    legacy = media_root / "project_a" / "asset_a"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"legacy")
    monkeypatch.setattr(media_assets, "MEDIA_DIR", media_root)

    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute(
        """
        CREATE TABLE media_assets (
          id TEXT, project_id TEXT, user_id TEXT, storage_path TEXT
        )
        """
    )
    db.execute(
        "INSERT INTO media_assets VALUES (?, ?, ?, ?)",
        ("asset_a", "project_a", "user_a", str(legacy)),
    )
    row = db.execute("SELECT * FROM media_assets").fetchone()

    with pytest.raises(HTTPException) as error:
        media_assets.resolve_owned_media_asset_file(row)

    assert error.value.status_code == 410
    assert error.value.detail["code"] == "media_asset_requires_migration"


def test_public_download_name_strips_path_and_control_characters():
    name = public_download_name("../private/\x00bad:name.mp4", fallback="media.mp4")

    assert name == "bad_name.mp4"
    assert "/" not in name
    assert "\\" not in name
    assert "\x00" not in name


def test_invalid_upload_magic_bytes_are_rejected(tmp_path: Path):
    fake = tmp_path / "fake.mp4"
    fake.write_bytes(b"not an mp4")

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            media_assets.validate_media_file_contents(
                fake,
                original_name="fake.mp4",
                require_video=True,
            )
        )

    assert error.value.status_code == 415


def test_migration_planner_finds_legacy_media_job_and_export(monkeypatch, tmp_path: Path):
    media_root = tmp_path / "media"
    upload_root = tmp_path / "uploads"
    export_root = tmp_path / "exports"
    for root in (media_root, upload_root, export_root):
        root.mkdir()
    legacy_media = media_root / "project_a" / "asset_a"
    legacy_media.parent.mkdir()
    legacy_media.write_bytes(b"media")
    legacy_upload = upload_root / "job_a_video.mp4"
    legacy_upload.write_bytes(b"upload")
    legacy_export = export_root / "export_a.mp4"
    legacy_export.write_bytes(b"export")
    monkeypatch.setattr(audit_migrate_disk_storage, "MEDIA_DIR", media_root)
    monkeypatch.setattr(audit_migrate_disk_storage, "UPLOAD_DIR", upload_root)
    monkeypatch.setattr(audit_migrate_disk_storage, "EXPORT_DIR", export_root)

    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        CREATE TABLE media_assets (
          id TEXT, project_id TEXT, user_id TEXT, original_name TEXT,
          mime_type TEXT, size_bytes INTEGER, storage_path TEXT,
          status TEXT, created_at TEXT, last_accessed_at TEXT, deleted_at TEXT
        );
        CREATE TABLE jobs (
          id TEXT, filename TEXT, user_id TEXT, project_id TEXT,
          media_asset_id TEXT, deleted_at TEXT
        );
        CREATE TABLE export_jobs (
          id TEXT, source_job_id TEXT, user_id TEXT, project_id TEXT,
          filename TEXT, output_path TEXT, deleted_at TEXT, download_url TEXT
        );
        """
    )
    db.execute(
        "INSERT INTO media_assets VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', '', '', NULL)",
        ("asset_a", "project_a", "user_a", "video.mp4", "video/mp4", 5, str(legacy_media)),
    )
    db.execute(
        "INSERT INTO jobs VALUES (?, ?, ?, ?, NULL, NULL)",
        ("job_a", "video.mp4", "user_a", "project_a"),
    )
    db.execute(
        "INSERT INTO export_jobs VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
        ("export_a", "job_a", "user_a", "project_a", "export_a.mp4", str(legacy_export)),
    )

    plans, quarantined, counts = audit_migrate_disk_storage.build_plan(db)

    assert not quarantined
    assert counts["mediaAssets"] == 1
    assert counts["legacyJobUploads"] == 1
    assert counts["exports"] == 1
    assert {plan.table for plan in plans} == {"media_assets", "jobs", "export_jobs"}


def test_storage_roots_are_not_public_static_mounts():
    mounted_paths = {
        getattr(route, "path", None)
        for route in app.routes
        if route.__class__.__name__ == "Mount"
    }

    assert "/uploads" not in mounted_paths
    assert "/media" not in mounted_paths
    assert "/exports" not in mounted_paths
    assert "/storage" not in mounted_paths
    assert "/tmp" not in mounted_paths


def test_legacy_filename_export_download_is_closed():
    with pytest.raises(HTTPException) as error:
        asyncio.run(export_jobs.download_export_file("../guess.mp4", db=None))

    assert error.value.status_code == 410


def test_legacy_root_export_path_is_not_downloadable(monkeypatch, tmp_path: Path):
    export_root = tmp_path / "exports"
    export_root.mkdir()
    legacy = export_root / "export_a.mp4"
    legacy.write_bytes(b"legacy export")
    monkeypatch.setattr(export_jobs, "EXPORT_DIR", export_root)

    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute(
        """
        CREATE TABLE export_jobs (
          id TEXT, source_job_id TEXT, user_id TEXT, project_id TEXT,
          output_path TEXT
        )
        """
    )
    db.execute(
        "INSERT INTO export_jobs VALUES (?, ?, ?, ?, ?)",
        ("export_a", "job_a", "user_a", "project_a", str(legacy)),
    )
    row = db.execute("SELECT * FROM export_jobs").fetchone()

    with pytest.raises(HTTPException) as error:
        export_jobs._resolve_scoped_export_file(row)

    assert error.value.status_code == 410
    assert error.value.detail["code"] == "export_requires_migration"
