from __future__ import annotations

from abc import ABC, abstractmethod
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from pathlib import Path

from .errors import StorageError
from .models import ProbeSource, StorageObjectMetadata, UploadAuthorization


class MediaStorage(ABC):
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
        del bucket, path, local_path, content_type, maximum_bytes, checksum, overwrite
        raise StorageError(
            "storage_provider_unavailable",
            "This Storage adapter does not support trusted backend uploads",
        )

    @abstractmethod
    async def create_upload_session(
        self, *, bucket: str, path: str, mime_type: str
    ) -> UploadAuthorization: ...

    @abstractmethod
    async def inspect_object(
        self, *, bucket: str, path: str
    ) -> StorageObjectMetadata: ...

    async def object_exists(self, *, bucket: str, path: str) -> bool:
        try:
            await self.inspect_object(bucket=bucket, path=path)
            return True
        except Exception as exc:
            from .errors import StorageError

            if isinstance(exc, StorageError) and exc.category == "object_not_found":
                return False
            raise

    @asynccontextmanager
    async def open_probe_source(
        self, *, bucket: str, path: str, expires_in: int
    ):
        """Yield an ephemeral trusted probe source without persisting it."""
        url = await self.create_read_url(
            bucket=bucket, path=path, expires_in=expires_in
        )
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise StorageError(
                "signed_url_failed",
                "Probe source must be a private HTTPS URL",
            )
        yield ProbeSource(
            kind="ephemeral_url",
            value=url,
            expires_at=datetime.now(timezone.utc)
            + timedelta(seconds=expires_in),
            redacted_display=f"https://{parsed.netloc}/[private-object]",
        )

    @abstractmethod
    async def create_read_url(
        self, *, bucket: str, path: str, expires_in: int
    ) -> str: ...

    @abstractmethod
    async def create_download_url(
        self,
        *,
        bucket: str,
        path: str,
        expires_in: int,
        filename: str,
    ) -> str: ...

    @abstractmethod
    async def delete_object(self, *, bucket: str, path: str) -> None: ...

    @abstractmethod
    async def move_object(
        self,
        *,
        source_bucket: str,
        source_path: str,
        destination_bucket: str,
        destination_path: str,
    ) -> None: ...

    @abstractmethod
    async def copy_object(
        self,
        *,
        source_bucket: str,
        source_path: str,
        destination_bucket: str,
        destination_path: str,
    ) -> None: ...
