from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

STORAGE_ERROR_CATEGORIES = frozenset(
    {
        "storage_not_configured",
        "bucket_not_allowed",
        "object_path_invalid",
        "object_not_found",
        "object_already_exists",
        "upload_session_not_found",
        "upload_session_expired",
        "upload_session_completed",
        "upload_size_mismatch",
        "upload_mime_mismatch",
        "upload_checksum_mismatch",
        "upload_not_complete",
        "signed_url_failed",
        "storage_permission_denied",
        "storage_provider_unavailable",
        "storage_delete_failed",
        "storage_metadata_invalid",
        "media_asset_not_ready",
        "media_asset_deleted",
        "idempotency_conflict",
        "idempotency_in_progress",
        "stale_revision",
    }
)


@dataclass
class StorageError(Exception):
    category: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.category not in STORAGE_ERROR_CATEGORIES:
            raise ValueError(f"unsupported storage error category: {self.category}")
        Exception.__init__(self, self.message)

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.category,
            "message": self.message,
            **({"details": self.details} if self.details else {}),
        }
