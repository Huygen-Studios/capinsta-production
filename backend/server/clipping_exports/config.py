from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path


def _enabled(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() in {"1", "true", "yes", "on"}


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True)
class ClippingExportConfig:
    preview_api_enabled: bool = False
    export_api_enabled: bool = False
    handler_enabled: bool = False
    preset: str = "vertical-mp4-v1"
    timeout_seconds: int = 7200
    maximum_output_bytes: int = 2 * 1024 * 1024 * 1024
    maximum_manifest_bytes: int = 10 * 1024 * 1024
    preview_ttl_seconds: int = 900
    download_ttl_seconds: int = 300
    temp_root: Path = Path(tempfile.gettempdir()) / "capinsta-clipping-exports"
    storage_backend: str = "supabase"
    local_storage_root: str = ""

    @classmethod
    def from_env(cls) -> "ClippingExportConfig":
        value = cls(
            preview_api_enabled=_enabled("ENABLE_CLIPPING_PREVIEW_API"),
            export_api_enabled=_enabled("ENABLE_CLIPPING_EXPORT_API"),
            handler_enabled=_enabled("ENABLE_CLIPPING_EXPORT_HANDLER"),
            preset=os.getenv("CLIPPING_EXPORT_PRESET", "vertical-mp4-v1").strip(),
            timeout_seconds=_integer(
                "CLIPPING_EXPORT_TIMEOUT_SECONDS", 7200, 30, 21600
            ),
            maximum_output_bytes=_integer(
                "CLIPPING_EXPORT_MAX_OUTPUT_BYTES",
                2 * 1024 * 1024 * 1024,
                1024,
                20 * 1024 * 1024 * 1024,
            ),
            maximum_manifest_bytes=_integer(
                "CLIPPING_PREVIEW_MAX_BYTES", 10 * 1024 * 1024, 1024, 50 * 1024 * 1024
            ),
            preview_ttl_seconds=_integer("CLIPPING_PREVIEW_TTL_SECONDS", 900, 60, 3600),
            download_ttl_seconds=_integer(
                "CLIPPING_EXPORT_DOWNLOAD_TTL_SECONDS", 300, 30, 3600
            ),
            temp_root=Path(
                os.getenv(
                    "CLIPPING_EXPORT_TEMP_ROOT",
                    str(Path(tempfile.gettempdir()) / "capinsta-clipping-exports"),
                )
            ),
            storage_backend=os.getenv("CLIPPING_EXPORT_STORAGE_BACKEND", "supabase")
            .strip()
            .lower(),
            local_storage_root=os.getenv(
                "CLIPPING_EXPORT_LOCAL_STORAGE_ROOT", ""
            ).strip(),
        )
        if (
            value.preview_api_enabled
            or value.export_api_enabled
            or value.handler_enabled
        ):
            value.validate()
        return value

    def validate(self) -> None:
        if self.preset != "vertical-mp4-v1":
            raise ValueError("CLIPPING_EXPORT_PRESET must be vertical-mp4-v1")
        if self.storage_backend not in {"supabase", "local"}:
            raise ValueError(
                "CLIPPING_EXPORT_STORAGE_BACKEND must be supabase or local"
            )
        if (
            self.storage_backend == "local"
            and (self.export_api_enabled or self.handler_enabled)
            and not self.local_storage_root
        ):
            raise ValueError(
                "CLIPPING_EXPORT_LOCAL_STORAGE_ROOT is required for local storage"
            )
