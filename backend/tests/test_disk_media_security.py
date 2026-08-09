import asyncio
import json
import sqlite3
from pathlib import Path

import aiosqlite
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from server.api import export_jobs
from server.api import jobs as jobs_api
from server.api import media_assets
from server.main import app
from scripts import audit_migrate_disk_storage
from server.auth import AuthenticatedUser, reset_current_user, set_current_user
from server.storage_paths import (
    path_inside,
    public_download_name,
    resolve_existing_file_inside,
)


JOBS_API_SOURCE = (Path(__file__).resolve().parents[1] / "server" / "api" / "jobs.py").read_text("utf-8")


class UploadStub:
    def __init__(self, filename: str, content_type: str | None = None):
        self.filename = filename
        self.content_type = content_type


def test_export_media_resolution_query_projects_canonical_media_fields():
    assert "SELECT\n                id,\n                user_id,\n                project_id,\n                storage_path\n            FROM media_assets" in JOBS_API_SOURCE
    assert "SELECT storage_path FROM media_assets" not in JOBS_API_SOURCE


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


def test_media_asset_row_missing_required_keys_is_structured_error():
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE media_assets (storage_path TEXT)")
    db.execute("INSERT INTO media_assets VALUES ('/tmp/missing.mp4')")
    row = db.execute("SELECT storage_path FROM media_assets").fetchone()

    with pytest.raises(HTTPException) as error:
        media_assets.resolve_owned_media_asset_file(row)

    assert error.value.status_code == 500
    assert error.value.detail["code"] == "media_asset_row_incomplete"
    assert "user_id" in error.value.detail["missingFields"]


def test_resolve_job_video_path_selects_complete_owned_media_row(monkeypatch, tmp_path: Path):
    async def run():
        media_root = tmp_path / "media"
        monkeypatch.setattr(media_assets, "MEDIA_DIR", media_root)
        asset_path = media_assets._asset_path("user_a", "project_a", "asset_a")
        asset_path.parent.mkdir(parents=True)
        asset_path.write_bytes(b"video")

        async with aiosqlite.connect(":memory:") as db:
            db.row_factory = aiosqlite.Row
            await db.executescript(
                """
                CREATE TABLE media_assets (
                  id TEXT, project_id TEXT, user_id TEXT, storage_path TEXT, deleted_at TEXT
                );
                CREATE TABLE jobs (
                  id TEXT, user_id TEXT, project_id TEXT, filename TEXT, media_asset_id TEXT
                );
                """
            )
            await db.execute(
                "INSERT INTO media_assets VALUES (?, ?, ?, ?, NULL)",
                ("asset_a", "project_a", "user_a", str(asset_path)),
            )
            await db.execute(
                "INSERT INTO jobs VALUES (?, ?, ?, ?, ?)",
                ("job_a", "user_a", "project_a", "video.mp4", "asset_a"),
            )
            await db.commit()
            row = await (await db.execute("SELECT * FROM jobs WHERE id = ?", ("job_a",))).fetchone()

            context = set_current_user(AuthenticatedUser(id="user_a"))
            try:
                resolved, mode = await jobs_api.resolve_job_video_path(db, "job_a", row)
            finally:
                reset_current_user(context)

        assert Path(resolved) == asset_path.resolve()
        assert mode == "direct_media_path"

    asyncio.run(run())


def test_cross_user_media_asset_cannot_be_resolved_for_export(monkeypatch, tmp_path: Path):
    async def run():
        media_root = tmp_path / "media"
        monkeypatch.setattr(media_assets, "MEDIA_DIR", media_root)
        asset_path = media_assets._asset_path("user_a", "project_a", "asset_a")
        asset_path.parent.mkdir(parents=True)
        asset_path.write_bytes(b"video")

        async with aiosqlite.connect(":memory:") as db:
            db.row_factory = aiosqlite.Row
            await db.executescript(
                """
                CREATE TABLE media_assets (
                  id TEXT, project_id TEXT, user_id TEXT, storage_path TEXT, deleted_at TEXT
                );
                CREATE TABLE jobs (
                  id TEXT, user_id TEXT, project_id TEXT, filename TEXT, media_asset_id TEXT
                );
                """
            )
            await db.execute(
                "INSERT INTO media_assets VALUES (?, ?, ?, ?, NULL)",
                ("asset_a", "project_a", "user_a", str(asset_path)),
            )
            await db.execute(
                "INSERT INTO jobs VALUES (?, ?, ?, ?, ?)",
                ("job_b", "user_b", "project_b", "video.mp4", "asset_a"),
            )
            await db.commit()
            row = await (await db.execute("SELECT * FROM jobs WHERE id = ?", ("job_b",))).fetchone()

            context = set_current_user(AuthenticatedUser(id="user_b"))
            try:
                with pytest.raises(HTTPException) as error:
                    await jobs_api.resolve_job_video_path(db, "job_b", row)
            finally:
                reset_current_user(context)

        assert error.value.status_code == 410
        assert error.value.detail["code"] == "legacy_job_media_requires_migration"

    asyncio.run(run())


def test_export_start_returns_json_for_incomplete_media_row(monkeypatch):
    async def run():
        async with aiosqlite.connect(":memory:") as db:
            db.row_factory = aiosqlite.Row
            await db.execute(
                "CREATE TABLE jobs (id TEXT, user_id TEXT, project_id TEXT, filename TEXT, media_asset_id TEXT)"
            )
            await db.execute(
                "INSERT INTO jobs VALUES (?, ?, ?, ?, ?)",
                ("job_a", "user_a", "project_a", "video.mp4", "asset_a"),
            )
            await db.commit()

            async def skip(*args, **kwargs):
                return None

            async def fail_resolution(*args, **kwargs):
                raise HTTPException(
                    status_code=500,
                    detail={
                        "code": "media_asset_row_incomplete",
                        "message": "The source media metadata is incomplete. Please retry after refreshing the project.",
                        "diagnosticId": "diag-test",
                        "missingFields": ["user_id"],
                    },
                )

            monkeypatch.setattr(export_jobs, "_prune_jobs", skip)
            monkeypatch.setattr(export_jobs, "require_feature", skip)
            monkeypatch.setattr(export_jobs, "enforce_export_quota", skip)
            monkeypatch.setattr(export_jobs, "require_disk_capacity", lambda **kwargs: None)
            monkeypatch.setattr(export_jobs, "ensure_project_available", skip)
            monkeypatch.setattr(export_jobs, "resolve_job_video_path", fail_resolution)

            request = Request({"type": "http", "headers": []})
            context = set_current_user(AuthenticatedUser(id="user_a"))
            try:
                response = await export_jobs.start_export_job(
                    request,
                    db=db,
                    source_job_id="job_a",
                    captions_json="[]",
                    theme="word_highlight_box",
                    style_config_json=None,
                    resolution="1080p",
                    export_width=None,
                    export_height=None,
                    export_fps=30,
                    include_audio=True,
                    quality="standard",
                    bitrate="auto",
                    custom_bitrate_mbps=None,
                    export_mode="full_video",
                    captions_only=False,
                    background_color="#101010",
                    duration_override=1.0,
                    duration_source=None,
                    duration_mode=None,
                    custom_duration=None,
                    visible_tracks_count=None,
                    source_media_count=None,
                    caption_chunks_count=None,
                    hardware_acceleration=False,
                    render_mode="headless",
                    composition_json=None,
                )
            finally:
                reset_current_user(context)

        assert response.status_code == 500
        assert response.media_type == "application/json"
        body = json.loads(response.body.decode("utf-8"))
        assert body["error"]["code"] == "media_asset_row_incomplete"
        assert body["error"]["missingFields"] == ["user_id"]

    asyncio.run(run())


def test_imported_subtitle_export_creates_and_reuses_media_backed_source(monkeypatch):
    async def run():
        async with aiosqlite.connect(":memory:") as db:
            db.row_factory = aiosqlite.Row
            await db.execute(
                """
                CREATE TABLE media_assets (
                    id TEXT, project_id TEXT, user_id TEXT, original_name TEXT,
                    deleted_at TEXT
                )
                """
            )
            await db.execute(
                """
                CREATE TABLE jobs (
                    id TEXT, status TEXT, progress INTEGER, filename TEXT,
                    target_lang TEXT, created_at TEXT, completed_at TEXT,
                    last_seen_at TEXT, expires_at TEXT, user_id TEXT,
                    project_id TEXT, media_asset_id TEXT, message TEXT,
                    heartbeat_at TEXT, updated_at TEXT,
                    transcription_provider TEXT, deleted_at TEXT
                )
                """
            )
            await db.execute(
                "INSERT INTO media_assets VALUES (?, ?, ?, ?, NULL)",
                ("asset_a", "project_a", "user_a", "video.mp4"),
            )
            await db.commit()
            monkeypatch.setattr(
                export_jobs, "resolve_owned_media_asset_file", lambda row: Path("video.mp4")
            )

            context = set_current_user(AuthenticatedUser(id="user_a"))
            try:
                first_id, first_row = await export_jobs._resolve_export_source_job(
                    db,
                    source_job_id=None,
                    media_asset_id="asset_a",
                    project_id="project_a",
                )
                second_id, second_row = await export_jobs._resolve_export_source_job(
                    db,
                    source_job_id=None,
                    media_asset_id="asset_a",
                    project_id="project_a",
                )
                no_media_id, no_media_row = (
                    await export_jobs._resolve_export_source_job(
                        db,
                        source_job_id=None,
                        media_asset_id=None,
                        project_id="project_a",
                    )
                )
            finally:
                reset_current_user(context)

        assert first_id == second_id
        assert first_row["transcription_provider"] == "subtitle_import"
        assert second_row["media_asset_id"] == "asset_a"
        assert second_row["status"] == "completed"
        assert no_media_id != first_id
        assert no_media_row["media_asset_id"] is None
        assert no_media_row["transcription_provider"] == "subtitle_import_no_media"

    asyncio.run(run())


def test_chunked_media_upload_persists_a_bounded_part(tmp_path, monkeypatch):
    async def run():
        monkeypatch.setattr(media_assets, "MEDIA_DIR", tmp_path)
        monkeypatch.setattr(
            media_assets, "require_disk_capacity", lambda **kwargs: None
        )
        context = set_current_user(AuthenticatedUser(id="user_a"))
        try:
            started = await media_assets.start_chunked_media_upload(
                project_id="project_a",
                file_name="video.mp4",
                mime_type="video/mp4",
                size_bytes=5,
            )
            consumed = False

            async def receive():
                nonlocal consumed
                if consumed:
                    return {"type": "http.request", "body": b"", "more_body": False}
                consumed = True
                return {
                    "type": "http.request",
                    "body": b"video",
                    "more_body": False,
                }

            request = Request(
                {
                    "type": "http",
                    "method": "PUT",
                    "path": f"/api/media/assets/chunked/{started['uploadId']}",
                    "headers": [
                        (b"x-upload-offset", b"0"),
                        (b"content-type", b"application/octet-stream"),
                    ],
                },
                receive,
            )
            appended = await media_assets.append_chunked_media_upload(
                started["uploadId"], request
            )
        finally:
            reset_current_user(context)

        assert appended["offset"] == 5
        part = next(tmp_path.rglob("*.part"))
        assert part.read_bytes() == b"video"

    asyncio.run(run())


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


@pytest.mark.parametrize(
    ("filename", "content_type"),
    [
        ("shell.php.jpg", "image/jpeg"),
        ("video.mp4.php", "video/mp4"),
        ("invoice.pdf.exe", "application/octet-stream"),
        ("movie.mov.sh", "video/quicktime"),
        ("archive.zip", "application/zip"),
        ("vector.svg", "image/svg+xml"),
        ("page.html", "text/html"),
    ],
)
def test_upload_metadata_rejects_bypass_and_unsupported_filenames(filename: str, content_type: str):
    with pytest.raises(HTTPException) as error:
        media_assets._validate_media_upload(UploadStub(filename, content_type))

    assert error.value.status_code == 415


def test_upload_metadata_rejects_mime_spoofing():
    with pytest.raises(HTTPException) as error:
        media_assets._validate_media_upload(UploadStub("image.png", "text/html"))

    assert error.value.status_code == 415
    assert error.value.detail["code"] == "UPLOAD_MIME_MISMATCH"


def test_safe_image_upload_metadata_and_magic_are_allowed(tmp_path: Path):
    assert media_assets._validate_media_upload(UploadStub("safe-image.png", "image/png")) == "safe-image.png"
    image = tmp_path / "safe-image.png"
    image.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\r"
        b"IHDR"
        b"\x00\x00\x00\x20"
        b"\x00\x00\x00\x20"
    )

    asyncio.run(media_assets.validate_media_file_contents(image, original_name="safe-image.png"))


def test_webm_video_upload_metadata_and_magic_are_allowed():
    assert media_assets._validate_media_upload(UploadStub("clip.webm", "video/webm")) == "clip.webm"
    assert jobs_api._validate_upload_metadata(UploadStub("clip.webm", "video/webm")) == "clip.webm"
    assert media_assets.sniff_magic_kind(b"\x1a\x45\xdf\xa3webm data") == "video"


def test_upload_magic_mismatch_is_rejected(tmp_path: Path):
    spoofed = tmp_path / "spoofed.png"
    spoofed.write_bytes(b"ID3\x04\x00\x00\x00\x00\x00\x21fake mp3 data")

    with pytest.raises(HTTPException) as error:
        asyncio.run(media_assets.validate_media_file_contents(spoofed, original_name="spoofed.png"))

    assert error.value.status_code == 415
    assert error.value.detail["code"] == "upload_magic_mismatch"


def test_caption_job_upload_metadata_accepts_range_audio():
    assert jobs_api._validate_upload_metadata(UploadStub("voice.mp3", "audio/mpeg")) == "voice.mp3"


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


def test_container_entrypoint_prepares_all_production_worker_roots():
    entrypoint = (Path(__file__).parents[1] / "docker-entrypoint.sh").read_text("utf-8")
    for name in (
        "AUTOMATIC_CLIPPER_TEMP_ROOT",
        "MEDIA_VARIANT_TEMP_ROOT",
        "TRANSCRIPTION_TEMP_ROOT",
        "CLIPPING_EXPORT_TEMP_ROOT",
    ):
        assert name in entrypoint


def test_container_entrypoint_runs_only_the_normal_editor_export_worker():
    entrypoint = (Path(__file__).parents[1] / "docker-entrypoint.sh").read_text("utf-8")

    assert "python -m server.production.migrate" in entrypoint
    assert "ENABLE_EDITOR_EXPORT_HANDLER=true" in entrypoint
    assert "PROCESSING_WORKER_REQUIRED_JOB_TYPES=editor_export" in entrypoint
    assert "ENABLE_CLIPPING_EXPORT_HANDLER=false" in entrypoint
    assert "ENABLE_VIRAL_CANDIDATE_ANALYSIS=false" in entrypoint


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
