import asyncio
import os
import time

from server.clipping_storage.errors import StorageError
from server.production.cleanup import (
    _abort_multipart,
    _cleanup_upload_storage,
    _cleanup_workspaces,
    _delete,
)


def test_workspace_cleanup_is_bounded_and_honors_dry_run(monkeypatch, tmp_path):
    old = tmp_path / "old-job"
    old.mkdir()
    os.utime(old, (time.time() - 7_200, time.time() - 7_200))
    monkeypatch.setenv("AUTOMATIC_CLIPPER_TEMP_ROOT", str(tmp_path))
    monkeypatch.setenv("TEMP_WORKSPACE_RETENTION_HOURS", "1")
    assert _cleanup_workspaces(dry_run=True, limit=1) == 1
    assert old.exists()
    assert _cleanup_workspaces(dry_run=False, limit=1) == 1
    assert not old.exists()


def test_missing_storage_object_is_a_successful_retention_retry():
    class Storage:
        async def delete_object(self, **_kwargs):
            raise StorageError("object_not_found", "gone")

    assert asyncio.run(_delete(Storage(), "source-media", "owner/source.mp4"))


def test_missing_multipart_upload_is_a_successful_retention_retry():
    class Storage:
        async def abort_multipart_upload(self, **_kwargs):
            raise StorageError("object_not_found", "gone")

    assert asyncio.run(
        _abort_multipart(Storage(), "source-media", "owner/source.mp4", "upload-1")
    )


def test_incomplete_multipart_without_id_is_not_deleted(caplog):
    class Storage:
        deleted = 0
        aborted = 0

        async def delete_object(self, **_kwargs):
            self.deleted += 1

        async def abort_multipart_upload(self, **_kwargs):
            self.aborted += 1

    storage = Storage()
    cleaned, aborted = asyncio.run(
        _cleanup_upload_storage(
            storage,
            bucket="source-media",
            path="owner/source.mp4",
            protocol="s3_multipart",
            provider_upload_id=None,
            multipart_upload_id=None,
        )
    )
    assert cleaned is True
    assert aborted is False
    assert storage.deleted == 0
    assert storage.aborted == 0
    assert "storage_delete_failed" not in caplog.text


def test_multipart_compatibility_id_is_aborted_and_completed_object_is_deleted():
    class Storage:
        def __init__(self):
            self.deleted = 0
            self.aborted = 0

        async def delete_object(self, **_kwargs):
            self.deleted += 1

        async def abort_multipart_upload(self, **_kwargs):
            self.aborted += 1

    storage = Storage()
    assert asyncio.run(
        _cleanup_upload_storage(
            storage,
            bucket="source-media",
            path="owner/source.mp4",
            protocol="s3_multipart",
            provider_upload_id=None,
            multipart_upload_id="compat-id",
        )
    ) == (True, True)
    assert storage.aborted == 1
    assert storage.deleted == 0

    assert asyncio.run(
        _cleanup_upload_storage(
            storage,
            bucket="source-media",
            path="owner/source.mp4",
            protocol="tus",
            provider_upload_id=None,
            multipart_upload_id=None,
        )
    ) == (True, False)
    assert storage.deleted == 1
