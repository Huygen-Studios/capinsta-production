from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from server.clipping_jobs.errors import JobOrchestrationError


def _enabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise JobOrchestrationError(
            "worker_not_configured", f"{name} must be an integer"
        ) from exc
    if not minimum <= value <= maximum:
        raise JobOrchestrationError(
            "worker_not_configured",
            f"{name} must be between {minimum} and {maximum}",
        )
    return value


@dataclass(frozen=True)
class DurableTranscriptionConfig:
    enabled: bool = False
    handler_timeout_seconds: int = 3600
    provider_timeout_seconds: int = 120
    source_url_ttl_seconds: int = 300
    source_download_timeout_seconds: int = 120
    maximum_source_bytes: int = 2_000_000_000
    maximum_provider_response_bytes: int = 64_000_000
    maximum_hotwords: int = 50
    maximum_hotword_length: int = 100
    temp_root: Path = Path(tempfile.gettempdir()) / "capinsta-transcription"
    storage_backend: str = "supabase"
    local_storage_root: str = "data/clipping-storage"

    @classmethod
    def from_env(cls) -> "DurableTranscriptionConfig":
        enabled = _enabled(
            os.getenv("ENABLE_DURABLE_TRANSCRIPTION_HANDLER")
        )
        if not enabled:
            return cls(enabled=False)
        backend = (
            os.getenv("TRANSCRIPTION_STORAGE_BACKEND", "supabase")
            .strip()
            .lower()
        )
        if backend not in {"supabase", "r2", "local"}:
            raise JobOrchestrationError(
                "worker_not_configured",
                "TRANSCRIPTION_STORAGE_BACKEND must be supabase, r2, or local",
            )
        config = cls(
            enabled=enabled,
            handler_timeout_seconds=_integer(
                "TRANSCRIPTION_HANDLER_TIMEOUT_SECONDS", 3600, 30, 7200
            ),
            provider_timeout_seconds=_integer(
                "TRANSCRIPTION_PROVIDER_TIMEOUT_SECONDS", 120, 5, 1800
            ),
            source_url_ttl_seconds=_integer(
                "TRANSCRIPTION_SOURCE_URL_TTL_SECONDS", 300, 30, 3600
            ),
            source_download_timeout_seconds=_integer(
                "TRANSCRIPTION_SOURCE_DOWNLOAD_TIMEOUT_SECONDS", 120, 5, 900
            ),
            maximum_source_bytes=_integer(
                "TRANSCRIPTION_MAX_SOURCE_BYTES",
                2_000_000_000,
                1_000_000,
                10_000_000_000,
            ),
            maximum_provider_response_bytes=_integer(
                "TRANSCRIPTION_MAX_PROVIDER_RESPONSE_BYTES",
                64_000_000,
                1_000_000,
                256_000_000,
            ),
            maximum_hotwords=_integer(
                "TRANSCRIPTION_MAX_HOTWORDS", 50, 0, 100
            ),
            maximum_hotword_length=_integer(
                "TRANSCRIPTION_MAX_HOTWORD_LENGTH", 100, 1, 200
            ),
            temp_root=Path(
                os.getenv(
                    "TRANSCRIPTION_TEMP_ROOT",
                    str(Path(tempfile.gettempdir()) / "capinsta-transcription"),
                )
            ),
            storage_backend=backend,
            local_storage_root=os.getenv(
                "CLIPPING_LOCAL_STORAGE_ROOT", "data/clipping-storage"
            ),
        )
        if (
            config.source_url_ttl_seconds
            <= config.source_download_timeout_seconds
        ):
            raise JobOrchestrationError(
                "worker_not_configured",
                "Transcription source URL TTL must exceed download timeout",
            )
        return config

    def effective_timeout(self, job_timeout_seconds: int) -> int:
        return min(
            self.handler_timeout_seconds,
            job_timeout_seconds,
        )


__all__ = ["DurableTranscriptionConfig"]
