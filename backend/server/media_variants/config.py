from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

from server.clipping_jobs.errors import JobOrchestrationError

_SAFE_BINARY = re.compile(r"^[A-Za-z0-9_.-]+$")


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
class MediaVariantConfig:
    enabled: bool = False
    enabled_job_types: tuple[str, ...] = (
        "proxy_generation",
        "audio_extraction",
        "thumbnail_generation",
        "waveform_generation",
    )
    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    temp_root: Path = Path(tempfile.gettempdir()) / "capinsta-media-variants"
    maximum_temp_bytes: int = 2 * 1024 * 1024 * 1024
    maximum_stderr_bytes: int = 65_536
    maximum_progress_bytes: int = 262_144
    terminate_grace_seconds: int = 3
    signed_url_ttl_seconds: int = 3600
    signed_url_safety_seconds: int = 30
    proxy_timeout_seconds: int = 1800
    proxy_max_output_bytes: int = 1024 * 1024 * 1024
    audio_timeout_seconds: int = 1800
    audio_max_output_bytes: int = 1024 * 1024 * 1024
    thumbnail_timeout_seconds: int = 120
    thumbnail_max_output_bytes: int = 20 * 1024 * 1024
    waveform_timeout_seconds: int = 1800
    waveform_max_output_bytes: int = 20 * 1024 * 1024
    waveform_max_peaks: int = 200_000
    waveform_bucket_duration_ms: int = 10
    duration_tolerance_ms: int = 1000
    storage_backend: str = "supabase"
    local_storage_root: str = ""

    @classmethod
    def from_env(cls) -> "MediaVariantConfig":
        raw_types = os.getenv(
            "MEDIA_VARIANT_JOB_TYPES",
            "proxy_generation,audio_extraction,thumbnail_generation,waveform_generation",
        )
        config = cls(
            enabled=_enabled(os.getenv("ENABLE_MEDIA_VARIANT_HANDLERS")),
            enabled_job_types=tuple(
                item.strip() for item in raw_types.split(",") if item.strip()
            ),
            ffmpeg_binary=(os.getenv("FFMPEG_BINARY") or "ffmpeg").strip(),
            ffprobe_binary=(
                os.getenv("FFPROBE_BINARY")
                or os.getenv("FFPROBE_PATH")
                or "ffprobe"
            ).strip(),
            temp_root=Path(
                os.getenv(
                    "MEDIA_VARIANT_TEMP_ROOT",
                    str(Path(tempfile.gettempdir()) / "capinsta-media-variants"),
                )
            ),
            maximum_temp_bytes=_integer(
                "MEDIA_VARIANT_MAX_TEMP_BYTES",
                2 * 1024 * 1024 * 1024,
                1_048_576,
                100 * 1024 * 1024 * 1024,
            ),
            maximum_stderr_bytes=_integer(
                "MEDIA_VARIANT_MAX_STDERR_BYTES", 65_536, 1024, 1_048_576
            ),
            maximum_progress_bytes=_integer(
                "MEDIA_VARIANT_MAX_PROGRESS_BYTES", 262_144, 1024, 4_194_304
            ),
            terminate_grace_seconds=_integer(
                "MEDIA_VARIANT_TERMINATE_GRACE_SECONDS", 3, 1, 30
            ),
            signed_url_ttl_seconds=_integer(
                "MEDIA_VARIANT_SIGNED_URL_TTL_SECONDS", 3600, 60, 86400
            ),
            signed_url_safety_seconds=_integer(
                "MEDIA_VARIANT_SIGNED_URL_SAFETY_SECONDS", 30, 1, 600
            ),
            proxy_timeout_seconds=_integer(
                "PROXY_TIMEOUT_SECONDS", 1800, 1, 7200
            ),
            proxy_max_output_bytes=_integer(
                "PROXY_MAX_OUTPUT_BYTES",
                1024 * 1024 * 1024,
                1024,
                10 * 1024 * 1024 * 1024,
            ),
            audio_timeout_seconds=_integer(
                "AUDIO_EXTRACTION_TIMEOUT_SECONDS", 1800, 1, 7200
            ),
            audio_max_output_bytes=_integer(
                "AUDIO_EXTRACTION_MAX_OUTPUT_BYTES",
                1024 * 1024 * 1024,
                1024,
                10 * 1024 * 1024 * 1024,
            ),
            thumbnail_timeout_seconds=_integer(
                "THUMBNAIL_TIMEOUT_SECONDS", 120, 1, 600
            ),
            thumbnail_max_output_bytes=_integer(
                "THUMBNAIL_MAX_OUTPUT_BYTES",
                20 * 1024 * 1024,
                1024,
                100 * 1024 * 1024,
            ),
            waveform_timeout_seconds=_integer(
                "WAVEFORM_TIMEOUT_SECONDS", 1800, 1, 7200
            ),
            waveform_max_output_bytes=_integer(
                "WAVEFORM_MAX_OUTPUT_BYTES",
                20 * 1024 * 1024,
                1024,
                100 * 1024 * 1024,
            ),
            waveform_max_peaks=_integer(
                "WAVEFORM_MAX_PEAKS", 200_000, 1, 1_000_000
            ),
            waveform_bucket_duration_ms=_integer(
                "WAVEFORM_BUCKET_DURATION_MS", 10, 1, 1000
            ),
            duration_tolerance_ms=_integer(
                "MEDIA_VARIANT_DURATION_TOLERANCE_MS", 1000, 0, 10_000
            ),
            storage_backend=(
                os.getenv("MEDIA_VARIANT_STORAGE_BACKEND") or "supabase"
            ).strip().lower(),
            local_storage_root=(
                os.getenv("MEDIA_VARIANT_LOCAL_STORAGE_ROOT") or ""
            ).strip(),
        )
        config.validate()
        return config

    def validate(self) -> None:
        allowed = {
            "proxy_generation",
            "audio_extraction",
            "thumbnail_generation",
            "waveform_generation",
        }
        if not self.enabled_job_types or not set(self.enabled_job_types) <= allowed:
            raise JobOrchestrationError(
                "worker_not_configured",
                "MEDIA_VARIANT_JOB_TYPES contains an unsupported job type",
            )
        for name, value in (
            ("FFMPEG_BINARY", self.ffmpeg_binary),
            ("FFPROBE_BINARY", self.ffprobe_binary),
        ):
            if (
                not value
                or "\x00" in value
                or "\n" in value
                or "\r" in value
                or (
                    not Path(value).is_absolute()
                    and not _SAFE_BINARY.fullmatch(value)
                )
            ):
                raise JobOrchestrationError(
                    "worker_not_configured",
                    f"{name} must be a trusted basename or absolute path",
                )
        if not self.temp_root.is_absolute():
            raise JobOrchestrationError(
                "worker_not_configured",
                "MEDIA_VARIANT_TEMP_ROOT must be an absolute trusted path",
            )
        if self.storage_backend not in {"supabase", "local"}:
            raise JobOrchestrationError(
                "worker_not_configured",
                "MEDIA_VARIANT_STORAGE_BACKEND must be supabase or local",
            )
        if self.enabled and self.storage_backend == "local" and (
            not self.local_storage_root
            or not Path(self.local_storage_root).is_absolute()
        ):
            raise JobOrchestrationError(
                "worker_not_configured",
                "Local variant storage requires an absolute trusted root",
            )

    def timeout_for(self, job_type: str) -> int:
        return {
            "proxy_generation": self.proxy_timeout_seconds,
            "audio_extraction": self.audio_timeout_seconds,
            "thumbnail_generation": self.thumbnail_timeout_seconds,
            "waveform_generation": self.waveform_timeout_seconds,
        }[job_type]

    def maximum_output_for(self, job_type: str) -> int:
        return {
            "proxy_generation": self.proxy_max_output_bytes,
            "audio_extraction": self.audio_max_output_bytes,
            "thumbnail_generation": self.thumbnail_max_output_bytes,
            "waveform_generation": self.waveform_max_output_bytes,
        }[job_type]


__all__ = ["MediaVariantConfig"]
