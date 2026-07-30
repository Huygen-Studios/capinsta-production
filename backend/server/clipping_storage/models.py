from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from uuid import UUID


@dataclass(frozen=True)
class StorageObjectMetadata:
    bucket: str
    path: str
    size_bytes: int
    mime_type: str | None = None
    etag: str | None = None
    checksum: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class ProbeSource:
    kind: Literal["local_path", "ephemeral_url"]
    value: str
    expires_at: datetime | None
    redacted_display: str


@dataclass(frozen=True)
class UploadAuthorization:
    protocol: Literal["tus", "s3_multipart"]
    upload_url: str | None
    required_headers: dict[str, str]
    upload_metadata: dict[str, str]
    provider_upload_id: str | None = None
    part_size_bytes: int | None = None
    part_count: int | None = None
    upload_concurrency: int | None = None
    signed_url_ttl_seconds: int | None = None
    uploaded_parts: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class UploadInstructions:
    media_asset_id: UUID
    upload_session_id: UUID
    protocol: Literal["tus", "s3_multipart"]
    upload_url: str | None
    required_headers: dict[str, str]
    upload_metadata: dict[str, str]
    expires_at: datetime
    maximum_size_bytes: int
    source_bucket_maximum_upload_bytes: int | None = None
    effective_known_maximum_upload_bytes: int | None = None
    limit_source: str = "application"
    replayed: bool = False
    provider: str = "supabase"
    part_size_bytes: int | None = None
    part_count: int | None = None
    upload_concurrency: int | None = None
    signed_url_ttl_seconds: int | None = None
    uploaded_parts: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "mediaAssetId": str(self.media_asset_id),
            "uploadSessionId": str(self.upload_session_id),
            "protocol": self.protocol,
            "requiredHeaders": self.required_headers,
            "uploadMetadata": self.upload_metadata,
            "expiresAt": self.expires_at.isoformat(),
            "maximumSizeBytes": self.maximum_size_bytes,
            "applicationMaximumUploadBytes": self.maximum_size_bytes,
            "sourceBucketMaximumUploadBytes": self.source_bucket_maximum_upload_bytes,
            "effectiveKnownMaximumUploadBytes": self.effective_known_maximum_upload_bytes
            or self.maximum_size_bytes,
            "limitSource": self.limit_source,
            "replayed": self.replayed,
            "provider": self.provider,
            **({"uploadUrl": self.upload_url} if self.upload_url else {}),
            **({"partSizeBytes": self.part_size_bytes} if self.part_size_bytes else {}),
            **({"partCount": self.part_count} if self.part_count else {}),
            **({"uploadConcurrency": self.upload_concurrency} if self.upload_concurrency else {}),
            **(
                {"signedUrlTtlSeconds": self.signed_url_ttl_seconds}
                if self.signed_url_ttl_seconds
                else {}
            ),
            **({"uploadedParts": self.uploaded_parts} if self.uploaded_parts else {}),
        }


@dataclass(frozen=True)
class SignedMediaUrl:
    media_asset_id: UUID
    url: str
    expires_at: datetime
    disposition: Literal["inline", "attachment"]

    def as_dict(self) -> dict[str, Any]:
        return {
            "mediaAssetId": str(self.media_asset_id),
            "url": self.url,
            "expiresAt": self.expires_at.isoformat(),
            "disposition": self.disposition,
        }


@dataclass(frozen=True)
class MediaAttachment:
    media_asset_id: UUID
    storage_provider: Literal["supabase", "r2", "local"]
    storage_bucket: str
    storage_path: str
    display_name: str
    mime_type: str | None
    size_bytes: int
    status: str
    requires_media_attachment: bool = False
    media_probe_job_id: UUID | None = None
    cleanup_pending: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "mediaAssetId": str(self.media_asset_id),
            "storageProvider": self.storage_provider,
            "storageBucket": self.storage_bucket,
            "storagePath": self.storage_path,
            "displayName": self.display_name,
            "mimeType": self.mime_type,
            "sizeBytes": self.size_bytes,
            "status": self.status,
            "requiresMediaAttachment": self.requires_media_attachment,
            "mediaProbeJobId": (
                str(self.media_probe_job_id) if self.media_probe_job_id else None
            ),
            "cleanupPending": self.cleanup_pending,
        }
