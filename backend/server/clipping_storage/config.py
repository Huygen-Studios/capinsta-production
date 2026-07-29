from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from .errors import StorageError


def _enabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _integer(
    name: str, default: int, minimum: int, maximum: int | None = None
) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise StorageError(
            "storage_not_configured", f"{name} must be an integer"
        ) from exc
    if value < minimum:
        raise StorageError(
            "storage_not_configured", f"{name} must be at least {minimum}"
        )
    if maximum is not None and value > maximum:
        raise StorageError(
            "storage_not_configured", f"{name} must be at most {maximum}"
        )
    return value


def _integer_any(
    names: tuple[str, ...], default: int, minimum: int, maximum: int | None = None
) -> int:
    for name in names:
        if os.getenv(name) is not None:
            return _integer(name, default, minimum, maximum)
    return _integer(names[0], default, minimum, maximum)


def _env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return value.strip()
    return default


@dataclass(frozen=True)
class MediaStorageConfig:
    enabled: bool
    storage_provider: str = "supabase"
    supabase_url: str = ""
    service_role_key: str = ""
    source_bucket: str = "source-media"
    variants_bucket: str = "media-variants"
    exports_bucket: str = "media-exports"
    upload_protocol: str = "tus"
    maximum_upload_bytes: int = 2 * 1024 * 1024 * 1024
    maximum_active_uploads_per_user: int = 2
    preview_ttl_seconds: int = 900
    download_ttl_seconds: int = 300
    maximum_url_ttl_seconds: int = 3600
    upload_session_ttl_seconds: int = 7200
    local_storage_root: str = ""
    r2_account_id: str = ""
    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_region: str = "auto"
    r2_source_bucket: str = "capinsta-source-media"
    r2_variants_bucket: str = "capinsta-media-variants"
    r2_exports_bucket: str = "capinsta-media-exports"
    r2_part_size_bytes: int = 32 * 1024 * 1024
    r2_signed_url_ttl_seconds: int = 900
    r2_upload_concurrency: int = 3

    @classmethod
    def from_env(cls) -> "MediaStorageConfig":
        local_storage_root = (os.getenv("CLIPPING_LOCAL_STORAGE_ROOT") or "").strip()
        local_enabled = _enabled(os.getenv("ENABLE_LOCAL_MEDIA_STORAGE"))
        provider = (os.getenv("CLIPPING_STORAGE_PROVIDER") or "").strip().lower()
        if not provider:
            provider = "local" if local_enabled else "supabase"
        config = cls(
            enabled=(
                provider == "r2"
                or _enabled(os.getenv("ENABLE_SUPABASE_MEDIA_STORAGE"))
                or local_enabled
            ),
            storage_provider=provider,
            supabase_url=(os.getenv("SUPABASE_URL") or "").rstrip("/"),
            service_role_key=(
                os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
            ).strip(),
            source_bucket=os.getenv(
                "SUPABASE_SOURCE_MEDIA_BUCKET", "source-media"
            ).strip(),
            variants_bucket=os.getenv(
                "SUPABASE_MEDIA_VARIANTS_BUCKET", "media-variants"
            ).strip(),
            exports_bucket=os.getenv(
                "SUPABASE_MEDIA_EXPORTS_BUCKET", "media-exports"
            ).strip(),
            upload_protocol=os.getenv("MEDIA_UPLOAD_PROTOCOL", "tus").strip(),
            maximum_upload_bytes=_integer(
                "MAX_SOURCE_FILE_BYTES",
                _integer("MEDIA_UPLOAD_MAX_BYTES", 2 * 1024 * 1024 * 1024, 1),
                1,
            ),
            maximum_active_uploads_per_user=_integer(
                "MAX_ACTIVE_UPLOADS_PER_USER", 2, 1
            ),
            preview_ttl_seconds=_integer(
                "MEDIA_PREVIEW_URL_TTL_SECONDS", 900, 1
            ),
            download_ttl_seconds=_integer(
                "MEDIA_DOWNLOAD_URL_TTL_SECONDS", 300, 1
            ),
            maximum_url_ttl_seconds=_integer(
                "MEDIA_SIGNED_URL_MAX_TTL_SECONDS", 3600, 1
            ),
            upload_session_ttl_seconds=_integer(
                "MEDIA_UPLOAD_SESSION_TTL_SECONDS", 7200, 60
            ),
            local_storage_root=local_storage_root,
            r2_account_id=_env("R2_ACCOUNT_ID"),
            r2_endpoint_url=_env("R2_ENDPOINT_URL", "R2_ENDPOINT").rstrip("/"),
            r2_access_key_id=_env("R2_ACCESS_KEY_ID"),
            r2_secret_access_key=_env("R2_SECRET_ACCESS_KEY"),
            r2_region=_env("R2_REGION", default="auto") or "auto",
            r2_source_bucket=_env("R2_SOURCE_BUCKET", default="capinsta-source-media"),
            r2_variants_bucket=_env(
                "R2_VARIANTS_BUCKET", default="capinsta-media-variants"
            ),
            r2_exports_bucket=_env("R2_EXPORTS_BUCKET", default="capinsta-media-exports"),
            r2_part_size_bytes=_integer(
                "R2_MULTIPART_PART_SIZE_BYTES", 32 * 1024 * 1024, 5 * 1024 * 1024
            ),
            r2_signed_url_ttl_seconds=_integer_any(
                ("R2_PRESIGNED_UPLOAD_TTL_SECONDS", "R2_SIGNED_URL_TTL_SECONDS"),
                900,
                60,
            ),
            r2_upload_concurrency=_integer_any(
                ("R2_MULTIPART_CONCURRENCY", "R2_UPLOAD_CONCURRENCY"),
                3,
                1,
                5,
            ),
        )
        if config.enabled:
            config.validate()
        return config

    def validate(self) -> None:
        if self.storage_provider not in {"supabase", "r2", "local"}:
            raise StorageError(
                "storage_not_configured",
                "CLIPPING_STORAGE_PROVIDER must be supabase, r2, or local",
            )
        if self.storage_provider == "local":
            if (
                os.getenv("NODE_ENV") == "production"
                or not self.local_storage_root
                or not Path(self.local_storage_root).is_absolute()
            ):
                raise StorageError(
                    "storage_not_configured",
                    "Local media storage is development-only and requires an absolute root",
                )
            return
        if self.storage_provider == "r2":
            parsed = urlparse(self.r2_endpoint_url)
            if (
                parsed.scheme != "https"
                or not parsed.netloc
                or not self.r2_access_key_id
                or not self.r2_secret_access_key
            ):
                raise StorageError(
                    "r2_not_configured",
                    "Cloudflare R2 media storage credentials are not configured",
                )
            if self.r2_account_id and self.r2_account_id not in parsed.netloc:
                raise StorageError(
                    "r2_not_configured",
                    "R2_ENDPOINT must include the configured R2_ACCOUNT_ID",
                )
            buckets = {
                self.r2_source_bucket,
                self.r2_variants_bucket,
                self.r2_exports_bucket,
            }
            if len(buckets) != 3:
                raise StorageError(
                    "r2_not_configured",
                    "R2 source, variants, and exports buckets must be distinct",
                )
            if self.r2_part_size_bytes < 5 * 1024 * 1024:
                raise StorageError(
                    "storage_not_configured",
                    "R2_MULTIPART_PART_SIZE_BYTES must be at least 5 MiB",
                )
            if self.maximum_upload_bytes // self.r2_part_size_bytes > 10_000:
                raise StorageError(
                    "storage_not_configured",
                    "R2 part size creates too many multipart parts",
                )
            return
        parsed = urlparse(self.supabase_url)
        if (
            not self.supabase_url
            or parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or not self.service_role_key
        ):
            raise StorageError(
                "storage_not_configured",
                "Supabase media storage credentials are not configured",
            )
        if self.upload_protocol != "tus":
            raise StorageError(
                "storage_not_configured",
                "MEDIA_UPLOAD_PROTOCOL must be tus",
            )
        if self.source_bucket != "source-media":
            raise StorageError(
                "bucket_not_allowed",
                "The durable source bucket must match the migration-managed bucket",
            )
        if self.variants_bucket != "media-variants":
            raise StorageError(
                "bucket_not_allowed",
                "The variants bucket must match the migration-managed bucket",
            )
        if self.exports_bucket != "media-exports":
            raise StorageError(
                "bucket_not_allowed",
                "The exports bucket must match the migration-managed bucket",
            )
        if max(self.preview_ttl_seconds, self.download_ttl_seconds) > (
            self.maximum_url_ttl_seconds
        ):
            raise StorageError(
                "storage_not_configured",
                "Signed URL defaults exceed the configured maximum",
            )

    @property
    def storage_api_url(self) -> str:
        return f"{self.supabase_url}/storage/v1"

    @property
    def tus_upload_url(self) -> str:
        parsed = urlparse(self.supabase_url)
        host = parsed.hostname or ""
        if parsed.scheme == "https" and host.endswith(".supabase.co"):
            project_ref = host.removesuffix(".supabase.co")
            return (
                f"https://{project_ref}.storage.supabase.co"
                "/storage/v1/upload/resumable"
            )
        return f"{self.storage_api_url}/upload/resumable"
