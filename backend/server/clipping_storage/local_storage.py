from __future__ import annotations

import asyncio
import hashlib
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .errors import StorageError
from .models import ProbeSource, StorageObjectMetadata, UploadAuthorization
from .paths import validate_export_object_path, validate_object_path
from .storage import MediaStorage


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class LocalMediaStorage(MediaStorage):
    """Explicit local-development adapter; existing production routes are unchanged."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, bucket: str, path: str) -> Path:
        validate_object_path(path)
        target = (self.root / bucket / Path(*path.split("/"))).resolve()
        if target != self.root and self.root not in target.parents:
            raise StorageError("object_path_invalid", "Local object path escaped root")
        return target

    async def create_upload_session(
        self, *, bucket: str, path: str, mime_type: str
    ) -> UploadAuthorization:
        self._path(bucket, path)
        return UploadAuthorization(
            protocol="tus",
            upload_url=f"local-storage://{uuid4()}",
            required_headers={},
            upload_metadata={
                "bucketName": bucket,
                "objectName": path,
                "contentType": mime_type,
            },
        )

    async def write_upload_chunk(
        self, *, bucket: str, path: str, offset: int, content: bytes
    ) -> int:
        target = self._path(bucket, path)
        if offset < 0:
            raise StorageError("upload_size_mismatch", "Upload offset must not be negative")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.stat().st_size != offset:
            raise StorageError("upload_size_mismatch", "Upload offset does not match local content")
        mode = "r+b" if target.exists() else "wb"
        with target.open(mode) as stream:
            stream.seek(offset)
            stream.write(content)
        return offset + len(content)

    async def inspect_object(
        self, *, bucket: str, path: str
    ) -> StorageObjectMetadata:
        target = self._path(bucket, path)
        if not target.is_file():
            raise StorageError("object_not_found", "Storage object was not found")
        stat = await asyncio.to_thread(target.stat)
        checksum = await asyncio.to_thread(_sha256, target)
        return StorageObjectMetadata(
            bucket=bucket,
            path=path,
            size_bytes=stat.st_size,
            checksum=checksum,
            updated_at=datetime.fromtimestamp(stat.st_mtime, timezone.utc),
        )

    async def upload_file(
        self,
        *,
        bucket: str,
        path: str,
        local_path: Path,
        content_type: str,
        maximum_bytes: int,
        checksum: str,
        overwrite: bool = False,
    ) -> StorageObjectMetadata:
        del content_type
        if bucket not in {"media-variants", "media-exports"}:
            raise StorageError(
                "bucket_not_allowed",
                "Trusted uploads require a managed output bucket",
            )
        if bucket == "media-exports":
            validate_export_object_path(path)
        source = local_path.resolve()
        if not source.is_file():
            raise StorageError("object_not_found", "Upload source was not found")
        size = source.stat().st_size
        if size <= 0 or size > maximum_bytes:
            raise StorageError(
                "upload_size_invalid", "Upload source exceeds its size limit"
            )
        target = self._path(bucket, path)
        if target.exists() and not overwrite:
            existing = await self.inspect_object(bucket=bucket, path=path)
            if existing.size_bytes == size and existing.checksum == checksum:
                return existing
            raise StorageError(
                "object_already_exists",
                "Storage object exists with different content",
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.copyfile, source, target)
        metadata = await self.inspect_object(bucket=bucket, path=path)
        if metadata.checksum != checksum:
            await self.delete_object(bucket=bucket, path=path)
            raise StorageError(
                "storage_metadata_invalid", "Uploaded object checksum differs"
            )
        return metadata

    async def create_read_url(
        self, *, bucket: str, path: str, expires_in: int
    ) -> str:
        raise StorageError(
            "signed_url_failed", "Local storage does not create signed URLs"
        )

    @asynccontextmanager
    async def open_probe_source(
        self, *, bucket: str, path: str, expires_in: int
    ):
        del expires_in
        target = self._path(bucket, path)
        if not target.is_file():
            raise StorageError("object_not_found", "Storage object was not found")
        yield ProbeSource(
            kind="local_path",
            value=str(target),
            expires_at=None,
            redacted_display="[local-private-object]",
        )

    async def create_download_url(
        self,
        *,
        bucket: str,
        path: str,
        expires_in: int,
        filename: str,
    ) -> str:
        raise StorageError(
            "signed_url_failed", "Local storage does not create signed URLs"
        )

    async def delete_object(self, *, bucket: str, path: str) -> None:
        await asyncio.to_thread(self._path(bucket, path).unlink, missing_ok=True)

    async def move_object(
        self,
        *,
        source_bucket: str,
        source_path: str,
        destination_bucket: str,
        destination_path: str,
    ) -> None:
        destination = self._path(destination_bucket, destination_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(
            shutil.move, self._path(source_bucket, source_path), destination
        )

    async def copy_object(
        self,
        *,
        source_bucket: str,
        source_path: str,
        destination_bucket: str,
        destination_path: str,
    ) -> None:
        destination = self._path(destination_bucket, destination_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(
            shutil.copy2, self._path(source_bucket, source_path), destination
        )
