from __future__ import annotations

import asyncio
import os
from contextlib import suppress
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlsplit, urlunsplit

import requests

from .config import MediaStorageConfig
from .errors import StorageError
from .models import StorageObjectMetadata, UploadAuthorization
from .paths import validate_export_object_path, validate_object_path
from .storage import MediaStorage


class SupabaseMediaStorage(MediaStorage):
    """Normalized service-role adapter for the Supabase Storage REST API."""

    def __init__(
        self,
        config: MediaStorageConfig,
        *,
        session: requests.Session | None = None,
    ) -> None:
        config.validate()
        self.config = config
        self.session = session or requests.Session()

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.config.service_role_key}",
            "apikey": self.config.service_role_key,
        }

    async def _request(
        self,
        method: str,
        endpoint: str,
        *,
        json: dict[str, Any] | None = None,
        expected: tuple[int, ...] = (200,),
        not_found_ok: bool = False,
    ) -> requests.Response:
        url = f"{self.config.storage_api_url}{endpoint}"
        try:
            response = await asyncio.to_thread(
                self.session.request,
                method,
                url,
                headers=self._headers(),
                json=json,
                timeout=10,
            )
        except requests.RequestException as exc:
            raise StorageError(
                "storage_provider_unavailable",
                "Supabase Storage is temporarily unavailable",
            ) from exc
        if response.status_code in expected:
            return response
        if response.status_code == 404 or (not_found_ok and response.status_code == 400):
            raise StorageError("object_not_found", "Storage object was not found")
        if response.status_code in {401, 403}:
            raise StorageError(
                "storage_permission_denied", "Storage operation was denied"
            )
        if response.status_code in {409, 422}:
            raise StorageError(
                "object_already_exists", "Storage object already exists"
            )
        raise StorageError(
            "storage_provider_unavailable",
            "Supabase Storage returned an unexpected response",
            {"status": response.status_code},
        )

    @staticmethod
    def _object_endpoint(prefix: str, bucket: str, path: str) -> str:
        validate_object_path(path)
        return f"{prefix}/{quote(bucket, safe='')}/{quote(path, safe='/')}"

    def _require_bucket(self, bucket: str) -> None:
        if bucket not in {
            self.config.source_bucket,
            self.config.variants_bucket,
            self.config.exports_bucket,
        }:
            raise StorageError(
                "bucket_not_allowed", "Storage bucket is not managed by Capinsta"
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
        self._require_bucket(bucket)
        if bucket not in {self.config.variants_bucket, self.config.exports_bucket}:
            raise StorageError(
                "bucket_not_allowed",
                "Trusted uploads require a managed output bucket",
            )
        if bucket == self.config.exports_bucket:
            validate_export_object_path(path)
        validate_object_path(path)
        try:
            size = os.path.getsize(local_path)
        except OSError as exc:
            raise StorageError(
                "object_not_found", "Upload source was not found"
            ) from exc
        if size <= 0 or size > maximum_bytes:
            raise StorageError(
                "upload_size_invalid", "Upload source exceeds its size limit"
            )
        if not overwrite:
            try:
                existing = await self.inspect_object(bucket=bucket, path=path)
            except StorageError as exc:
                if exc.category != "object_not_found":
                    raise
            else:
                if (
                    existing.size_bytes == size
                    and existing.checksum is not None
                    and existing.checksum == checksum
                ):
                    return existing
                raise StorageError(
                    "object_already_exists",
                    "Storage object exists with different content",
                )

        endpoint = self._object_endpoint("/object", bucket, path)
        url = f"{self.config.storage_api_url}{endpoint}"

        def perform_upload() -> requests.Response:
            with local_path.open("rb") as stream:
                headers = self._headers()
                headers.update(
                    {
                        "Content-Type": content_type,
                        "Content-Length": str(size),
                        "x-upsert": "true" if overwrite else "false",
                    }
                )
                return self.session.request(
                    "POST", url, headers=headers, data=stream, timeout=60
                )

        try:
            response = await asyncio.to_thread(perform_upload)
        except (requests.RequestException, OSError) as exc:
            raise StorageError(
                "storage_provider_unavailable",
                "Supabase Storage upload is temporarily unavailable",
            ) from exc
        if response.status_code not in {200, 201}:
            if response.status_code in {409, 422}:
                raise StorageError(
                    "object_already_exists",
                    "Storage object exists with different content",
                )
            if response.status_code in {401, 403}:
                raise StorageError(
                    "storage_permission_denied", "Storage upload was denied"
                )
            raise StorageError(
                "storage_provider_unavailable",
                "Supabase Storage upload failed",
                {"status": response.status_code},
            )
        metadata = await self.inspect_object(bucket=bucket, path=path)
        if metadata.size_bytes != size:
            with suppress(StorageError):
                await self.delete_object(bucket=bucket, path=path)
            raise StorageError(
                "storage_metadata_invalid", "Uploaded object size differs"
            )
        if metadata.checksum is not None and metadata.checksum != checksum:
            with suppress(StorageError):
                await self.delete_object(bucket=bucket, path=path)
            raise StorageError(
                "storage_metadata_invalid", "Uploaded object checksum differs"
            )
        return metadata

    async def create_upload_session(
        self, *, bucket: str, path: str, mime_type: str
    ) -> UploadAuthorization:
        self._require_bucket(bucket)
        if bucket != self.config.source_bucket:
            raise StorageError(
                "bucket_not_allowed",
                "Direct uploads are allowed only for source media",
            )
        response = await self._request(
            "POST",
            self._object_endpoint("/object/upload/sign", bucket, path),
            json={"allowOverwrite": False},
            expected=(200, 201),
        )
        try:
            payload = response.json()
        except ValueError as exc:
            raise StorageError(
                "storage_metadata_invalid",
                "Signed upload authorization was malformed",
            ) from exc
        signed_path = str(
            payload.get("signedURL")
            or payload.get("signedUrl")
            or payload.get("url")
            or ""
        )
        token = str(payload.get("token") or "")
        if not token and signed_path:
            token = (parse_qs(urlsplit(signed_path).query).get("token") or [""])[0]
        if not token:
            raise StorageError(
                "storage_metadata_invalid",
                "Signed upload authorization did not include a token",
            )
        return UploadAuthorization(
            protocol="tus",
            upload_url=self.config.tus_upload_url,
            required_headers={"x-signature": token, "x-upsert": "false"},
            upload_metadata={
                "bucketName": bucket,
                "objectName": path,
                "contentType": mime_type,
                "cacheControl": "3600",
            },
        )

    async def inspect_object(
        self, *, bucket: str, path: str
    ) -> StorageObjectMetadata:
        self._require_bucket(bucket)
        response = await self._request(
            "HEAD",
            self._object_endpoint("/object/info", bucket, path),
            expected=(200,),
        )
        try:
            size = int(response.headers.get("content-length", ""))
        except ValueError as exc:
            raise StorageError(
                "storage_metadata_invalid",
                "Storage object size metadata is invalid",
            ) from exc
        if size < 0:
            raise StorageError(
                "storage_metadata_invalid", "Storage object size is invalid"
            )
        modified = response.headers.get("last-modified")
        updated_at = None
        if modified:
            try:
                updated_at = parsedate_to_datetime(modified)
            except (TypeError, ValueError):
                updated_at = None
        return StorageObjectMetadata(
            bucket=bucket,
            path=path,
            size_bytes=size,
            mime_type=response.headers.get("content-type"),
            etag=(response.headers.get("etag") or "").strip('"') or None,
            checksum=response.headers.get("x-supabase-checksum"),
            updated_at=updated_at,
        )

    async def _signed_url(
        self,
        *,
        bucket: str,
        path: str,
        expires_in: int,
        filename: str | None = None,
    ) -> str:
        self._require_bucket(bucket)
        response = await self._request(
            "POST",
            self._object_endpoint("/object/sign", bucket, path),
            json={"expiresIn": expires_in},
            expected=(200,),
        )
        try:
            payload = response.json()
        except ValueError as exc:
            raise StorageError(
                "signed_url_failed", "Signed Storage URL response was malformed"
            ) from exc
        signed = str(
            payload.get("signedURL") or payload.get("signedUrl") or ""
        )
        if not signed:
            raise StorageError(
                "signed_url_failed", "Supabase Storage did not return a signed URL"
            )
        url = (
            signed
            if signed.startswith(("https://", "http://"))
            else urljoin(f"{self.config.storage_api_url}/", signed.lstrip("/"))
        )
        if filename is not None:
            parts = urlsplit(url)
            query = parse_qs(parts.query, keep_blank_values=True)
            query["download"] = [filename]
            url = urlunsplit(
                (parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), "")
            )
        return url

    async def create_read_url(
        self, *, bucket: str, path: str, expires_in: int
    ) -> str:
        return await self._signed_url(
            bucket=bucket, path=path, expires_in=expires_in
        )

    async def create_download_url(
        self,
        *,
        bucket: str,
        path: str,
        expires_in: int,
        filename: str,
    ) -> str:
        return await self._signed_url(
            bucket=bucket,
            path=path,
            expires_in=expires_in,
            filename=filename,
        )

    async def delete_object(self, *, bucket: str, path: str) -> None:
        self._require_bucket(bucket)
        try:
            await self._request(
                "DELETE",
                self._object_endpoint("/object", bucket, path),
                expected=(200, 204),
            )
        except StorageError as exc:
            if exc.category == "object_not_found":
                return
            if exc.category == "storage_provider_unavailable":
                raise StorageError(
                    "storage_delete_failed", "Storage object could not be deleted"
                ) from exc
            raise

    async def _transfer(
        self,
        operation: str,
        *,
        source_bucket: str,
        source_path: str,
        destination_bucket: str,
        destination_path: str,
    ) -> None:
        self._require_bucket(source_bucket)
        self._require_bucket(destination_bucket)
        validate_object_path(source_path)
        validate_object_path(destination_path)
        await self._request(
            "POST",
            f"/object/{operation}",
            json={
                "bucketId": source_bucket,
                "sourceKey": source_path,
                "destinationBucket": destination_bucket,
                "destinationKey": destination_path,
            },
            expected=(200,),
        )

    async def move_object(self, **kwargs: Any) -> None:
        await self._transfer("move", **kwargs)

    async def copy_object(self, **kwargs: Any) -> None:
        await self._transfer("copy", **kwargs)
