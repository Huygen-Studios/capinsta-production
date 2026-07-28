from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from server.clipping_jobs.errors import JobOrchestrationError

_SAFE_BASENAME = re.compile(r"^[A-Za-z0-9_.-]+$")


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
class MediaProbeConfig:
    enabled: bool = False
    ffprobe_binary: str = "ffprobe"
    timeout_seconds: int = 45
    terminate_grace_seconds: int = 3
    signed_url_ttl_seconds: int = 120
    signed_url_safety_seconds: int = 10
    maximum_stdout_bytes: int = 1_048_576
    maximum_stderr_bytes: int = 65_536
    probe_size_bytes: int = 5_000_000
    analyze_duration_microseconds: int = 5_000_000
    maximum_duration_ms: int = 86_400_000
    maximum_fps: int = 240
    storage_backend: str = "supabase"
    local_storage_root: str = ""

    @classmethod
    def from_env(
        cls, *, job_timeout_seconds: int = 120
    ) -> "MediaProbeConfig":
        config = cls(
            enabled=_enabled(os.getenv("ENABLE_MEDIA_PROBE_HANDLER")),
            ffprobe_binary=(
                os.getenv("FFPROBE_BINARY")
                or os.getenv("FFPROBE_PATH")
                or "ffprobe"
            ).strip(),
            timeout_seconds=_integer(
                "MEDIA_PROBE_TIMEOUT_SECONDS", 45, 1, 600
            ),
            terminate_grace_seconds=_integer(
                "MEDIA_PROBE_TERMINATE_GRACE_SECONDS", 3, 1, 30
            ),
            signed_url_ttl_seconds=_integer(
                "MEDIA_PROBE_SIGNED_URL_TTL_SECONDS", 120, 10, 3600
            ),
            signed_url_safety_seconds=_integer(
                "MEDIA_PROBE_SIGNED_URL_SAFETY_SECONDS", 10, 1, 120
            ),
            maximum_stdout_bytes=_integer(
                "MEDIA_PROBE_MAX_STDOUT_BYTES", 1_048_576, 1024, 8_388_608
            ),
            maximum_stderr_bytes=_integer(
                "MEDIA_PROBE_MAX_STDERR_BYTES", 65_536, 1024, 1_048_576
            ),
            probe_size_bytes=_integer(
                "MEDIA_PROBE_PROBE_SIZE_BYTES", 5_000_000, 32_768, 50_000_000
            ),
            analyze_duration_microseconds=_integer(
                "MEDIA_PROBE_ANALYZE_DURATION_MICROSECONDS",
                5_000_000,
                32_768,
                60_000_000,
            ),
            maximum_duration_ms=_integer(
                "MEDIA_PROBE_MAX_DURATION_MS",
                86_400_000,
                1,
                604_800_000,
            ),
            maximum_fps=_integer("MEDIA_PROBE_MAX_FPS", 240, 1, 1000),
            storage_backend=(
                os.getenv("MEDIA_PROBE_STORAGE_BACKEND") or "supabase"
            ).strip().lower(),
            local_storage_root=(
                os.getenv("MEDIA_PROBE_LOCAL_STORAGE_ROOT") or ""
            ).strip(),
        )
        config.validate(job_timeout_seconds=job_timeout_seconds)
        return config

    def validate(self, *, job_timeout_seconds: int = 120) -> None:
        binary = self.ffprobe_binary
        if (
            not binary
            or "\x00" in binary
            or "\n" in binary
            or "\r" in binary
            or (
                not Path(binary).is_absolute()
                and not _SAFE_BASENAME.fullmatch(binary)
            )
        ):
            raise JobOrchestrationError(
                "worker_not_configured",
                "FFPROBE_BINARY must be a trusted basename or absolute path",
            )
        if self.timeout_seconds >= job_timeout_seconds:
            raise JobOrchestrationError(
                "worker_not_configured",
                "Media probe timeout must be shorter than the job timeout",
            )
        if self.signed_url_ttl_seconds <= (
            self.timeout_seconds + self.signed_url_safety_seconds
        ):
            raise JobOrchestrationError(
                "worker_not_configured",
                "Signed URL TTL must exceed probe timeout plus its safety margin",
            )
        if self.storage_backend not in {"supabase", "local"}:
            raise JobOrchestrationError(
                "worker_not_configured",
                "MEDIA_PROBE_STORAGE_BACKEND must be supabase or local",
            )
        if self.enabled and self.storage_backend == "local" and (
            not self.local_storage_root
            or not Path(self.local_storage_root).is_absolute()
        ):
            raise JobOrchestrationError(
                "worker_not_configured",
                "Local probe storage requires an absolute trusted root",
            )
