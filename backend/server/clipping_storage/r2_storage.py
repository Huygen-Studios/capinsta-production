from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from botocore.exceptions import BotoCoreError, ClientError
except Exception:  # pragma: no cover - boto3 is optional unless R2 is enabled
    class BotoCoreError(Exception):
        pass

    class ClientError(Exception):
        response: dict[str, Any] = {}

from .config import MediaStorageConfig
from .errors import StorageError
from .models import StorageObjectMetadata, UploadAuthorization
from .paths import validate_export_object_path, validate_object_path
from .storage import MediaStorage


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class R2MediaStorage(MediaStorage):
    def __init__(self, config: MediaStorageConfig, *, client: Any | None = None) -> None:
        config.validate()
        self.config = config
        if client is not None:
            self.client = client
            return
        try:
            import boto3
            from botocore.config import Config
        except Exception as exc:
            raise StorageError(
                "r2_not_configured", "Cloudflare R2 support requires boto3"
            ) from exc
        self.client = boto3.client(
            "s3",
            endpoint_url=config.r2_endpoint_url,
            region_name=config.r2_region,
            aws_access_key_id=config.r2_access_key_id,
            aws_secret_access_key=config.r2_secret_access_key,
            config=Config(
                connect_timeout=5,
                read_timeout=30,
                retries={"max_attempts": 3, "mode": "standard"},
                user_agent_extra="capinsta-r2-media-storage/1",
                s3={"addressing_style": "path"},
            ),
        )

    def _bucket(self, bucket: str) -> str:
        mapping = {
            self.config.source_bucket: self.config.r2_source_bucket,
            self.config.variants_bucket: self.config.r2_variants_bucket,
            self.config.exports_bucket: self.config.r2_exports_bucket,
        }
        try:
            return mapping[bucket]
        except KeyError as exc:
            raise StorageError(
                "bucket_not_allowed", "Storage bucket is not managed by Capinsta"
            ) from exc

    @staticmethod
    def _error(exc: Exception, fallback: str) -> StorageError:
        status = None
        code = None
        if isinstance(exc, ClientError):
            response = exc.response or {}
            status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            code = response.get("Error", {}).get("Code")
        if status == 404 or code in {"NoSuchBucket", "NoSuchKey", "NotFound"}:
            return StorageError("object_not_found", "Storage object was not found")
        if status in {401, 403}:
            return StorageError("storage_permission_denied", "Storage operation was denied")
        return StorageError(
            fallback,
            "Cloudflare R2 Storage is temporarily unavailable",
            {"status": status} if status else {},
        )

    async def create_upload_session(
        self, *, bucket: str, path: str, mime_type: str
    ) -> UploadAuthorization:
        upload_id = await self.create_multipart_upload(
            bucket=bucket, path=path, mime_type=mime_type
        )
        return UploadAuthorization(
            protocol="s3_multipart",
            upload_url=None,
            required_headers={},
            upload_metadata={},
            provider_upload_id=upload_id,
            part_size_bytes=self.config.r2_part_size_bytes,
            signed_url_ttl_seconds=self.config.r2_signed_url_ttl_seconds,
        )

    async def create_multipart_upload(
        self, *, bucket: str, path: str, mime_type: str
    ) -> str:
        validate_object_path(path)
        try:
            response = await asyncio.to_thread(
                self.client.create_multipart_upload,
                Bucket=self._bucket(bucket),
                Key=path,
                ContentType=mime_type,
                Metadata={"capinsta-logical-bucket": bucket},
            )
        except (BotoCoreError, ClientError) as exc:
            raise self._error(exc, "multipart_creation_failed") from exc
        upload_id = str(response.get("UploadId") or "")
        if not upload_id:
            raise StorageError(
                "multipart_creation_failed", "R2 did not return a multipart upload id"
            )
        return upload_id

    async def create_upload_part_url(
        self, *, bucket: str, path: str, upload_id: str, part_number: int, expires_in: int
    ) -> str:
        validate_object_path(path)
        if not 1 <= part_number <= 10_000:
            raise StorageError("multipart_part_mismatch", "Multipart part number is invalid")
        try:
            return await asyncio.to_thread(
                self.client.generate_presigned_url,
                "upload_part",
                Params={
                    "Bucket": self._bucket(bucket),
                    "Key": path,
                    "UploadId": upload_id,
                    "PartNumber": part_number,
                },
                ExpiresIn=expires_in,
                HttpMethod="PUT",
            )
        except (BotoCoreError, ClientError) as exc:
            raise self._error(exc, "multipart_part_failed") from exc

    async def list_multipart_parts(
        self, *, bucket: str, path: str, upload_id: str
    ) -> list[dict[str, int | str]]:
        validate_object_path(path)
        try:
            response = await asyncio.to_thread(
                self.client.list_parts,
                Bucket=self._bucket(bucket),
                Key=path,
                UploadId=upload_id,
            )
        except (BotoCoreError, ClientError) as exc:
            raise self._error(exc, "multipart_part_failed") from exc
        return [
            {
                "partNumber": int(part["PartNumber"]),
                "etag": str(part["ETag"]).strip('"'),
                "size": int(part["Size"]),
            }
            for part in response.get("Parts", [])
        ]

    async def complete_multipart_upload(
        self, *, bucket: str, path: str, upload_id: str, parts: list[dict[str, int | str]]
    ) -> StorageObjectMetadata:
        validate_object_path(path)
        if not parts:
            raise StorageError("multipart_part_mismatch", "Multipart upload has no parts")
        payload = {
            "Parts": [
                {"PartNumber": int(part["partNumber"]), "ETag": str(part["etag"])}
                for part in sorted(parts, key=lambda item: int(item["partNumber"]))
            ]
        }
        try:
            await asyncio.to_thread(
                self.client.complete_multipart_upload,
                Bucket=self._bucket(bucket),
                Key=path,
                UploadId=upload_id,
                MultipartUpload=payload,
            )
        except (BotoCoreError, ClientError) as exc:
            raise self._error(exc, "multipart_completion_failed") from exc
        return await self.inspect_object(bucket=bucket, path=path)

    async def abort_multipart_upload(
        self, *, bucket: str, path: str, upload_id: str
    ) -> None:
        validate_object_path(path)
        try:
            await asyncio.to_thread(
                self.client.abort_multipart_upload,
                Bucket=self._bucket(bucket),
                Key=path,
                UploadId=upload_id,
            )
        except (BotoCoreError, ClientError) as exc:
            error = self._error(exc, "multipart_abort_failed")
            if error.category != "object_not_found":
                raise error from exc

    async def inspect_object(self, *, bucket: str, path: str) -> StorageObjectMetadata:
        validate_object_path(path)
        try:
            response = await asyncio.to_thread(
                self.client.head_object, Bucket=self._bucket(bucket), Key=path
            )
        except (BotoCoreError, ClientError) as exc:
            raise self._error(exc, "object_not_found") from exc
        return StorageObjectMetadata(
            bucket=bucket,
            path=path,
            size_bytes=int(response["ContentLength"]),
            mime_type=response.get("ContentType"),
            etag=str(response.get("ETag") or "").strip('"') or None,
            updated_at=response.get("LastModified"),
        )

    async def create_read_url(self, *, bucket: str, path: str, expires_in: int) -> str:
        validate_object_path(path)
        try:
            return await asyncio.to_thread(
                self.client.generate_presigned_url,
                "get_object",
                Params={"Bucket": self._bucket(bucket), "Key": path},
                ExpiresIn=expires_in,
                HttpMethod="GET",
            )
        except (BotoCoreError, ClientError) as exc:
            raise self._error(exc, "signed_url_failed") from exc

    async def create_download_url(
        self, *, bucket: str, path: str, expires_in: int, filename: str
    ) -> str:
        validate_object_path(path)
        try:
            return await asyncio.to_thread(
                self.client.generate_presigned_url,
                "get_object",
                Params={
                    "Bucket": self._bucket(bucket),
                    "Key": path,
                    "ResponseContentDisposition": f'attachment; filename="{filename}"',
                },
                ExpiresIn=expires_in,
                HttpMethod="GET",
            )
        except (BotoCoreError, ClientError) as exc:
            raise self._error(exc, "signed_url_failed") from exc

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
        if bucket == self.config.exports_bucket:
            validate_export_object_path(path)
        else:
            validate_object_path(path)
        size = local_path.stat().st_size
        if size <= 0 or size > maximum_bytes:
            raise StorageError("upload_size_invalid", "Upload source exceeds its size limit")
        if not overwrite and await self.object_exists(bucket=bucket, path=path):
            existing = await self.inspect_object(bucket=bucket, path=path)
            if existing.size_bytes == size:
                return existing
            raise StorageError("object_already_exists", "Storage object already exists")

        extra = {"ContentType": content_type, "Metadata": {"sha256": checksum}}
        try:
            await asyncio.to_thread(
                self.client.upload_file,
                str(local_path),
                self._bucket(bucket),
                path,
                ExtraArgs=extra,
            )
        except (BotoCoreError, ClientError, OSError) as exc:
            raise self._error(exc, "storage_provider_unavailable") from exc
        metadata = await self.inspect_object(bucket=bucket, path=path)
        if metadata.size_bytes != size:
            await self.delete_object(bucket=bucket, path=path)
            raise StorageError("object_size_mismatch", "Uploaded object size differs")
        return metadata

    async def delete_object(self, *, bucket: str, path: str) -> None:
        validate_object_path(path)
        try:
            await asyncio.to_thread(
                self.client.delete_object, Bucket=self._bucket(bucket), Key=path
            )
        except (BotoCoreError, ClientError) as exc:
            raise self._error(exc, "storage_delete_failed") from exc

    async def copy_object(
        self,
        *,
        source_bucket: str,
        source_path: str,
        destination_bucket: str,
        destination_path: str,
    ) -> None:
        validate_object_path(source_path)
        validate_object_path(destination_path)
        try:
            await asyncio.to_thread(
                self.client.copy_object,
                Bucket=self._bucket(destination_bucket),
                Key=destination_path,
                CopySource={"Bucket": self._bucket(source_bucket), "Key": source_path},
            )
        except (BotoCoreError, ClientError) as exc:
            raise self._error(exc, "storage_provider_unavailable") from exc

    async def move_object(self, **kwargs: Any) -> None:
        await self.copy_object(**kwargs)
        await self.delete_object(
            bucket=kwargs["source_bucket"], path=kwargs["source_path"]
        )
