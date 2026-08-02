from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from server.clipping_jobs.errors import JobOrchestrationError


def _bool(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise JobOrchestrationError("worker_not_configured", f"{name} must be an integer") from exc
    if not low <= value <= high:
        raise JobOrchestrationError(
            "worker_not_configured", f"{name} must be between {low} and {high}"
        )
    return value


@dataclass(frozen=True)
class TranscriptAnalysisConfig:
    handlers_enabled: bool = False
    planning_enabled: bool = False
    job_types: tuple[str, ...] = ("silence_analysis", "transcript_analysis")
    silence_timeout_seconds: int = 600
    transcript_timeout_seconds: int = 120
    source_url_ttl_seconds: int = 300
    source_download_timeout_seconds: int = 120
    maximum_source_bytes: int = 2_000_000_000
    maximum_stderr_bytes: int = 1_048_576
    temp_root: Path = Path(tempfile.gettempdir()) / "capinsta-transcript-analysis"
    storage_backend: str = "supabase"
    local_storage_root: str = "data/clipping-storage"
    ffmpeg_path: str = "ffmpeg"

    @classmethod
    def from_env(cls) -> "TranscriptAnalysisConfig":
        enabled = _bool("ENABLE_TRANSCRIPT_ANALYSIS_HANDLERS")
        planning = _bool("ENABLE_TRANSCRIPT_ANALYSIS_PLANNING")
        if not enabled:
            return cls(handlers_enabled=False, planning_enabled=planning)
        raw_types = os.getenv(
            "TRANSCRIPT_ANALYSIS_JOB_TYPES",
            "silence_analysis,transcript_analysis",
        )
        types = tuple(dict.fromkeys(x.strip() for x in raw_types.split(",") if x.strip()))
        supported = {"silence_analysis", "transcript_analysis"}
        if not types or not set(types) <= supported:
            raise JobOrchestrationError(
                "worker_not_configured",
                "TRANSCRIPT_ANALYSIS_JOB_TYPES contains an unsupported job type",
            )
        backend = os.getenv("TRANSCRIPT_ANALYSIS_STORAGE_BACKEND", "supabase").strip().lower()
        if backend not in {"supabase", "r2", "local"}:
            raise JobOrchestrationError(
                "worker_not_configured",
                "TRANSCRIPT_ANALYSIS_STORAGE_BACKEND must be supabase, r2, or local",
            )
        return cls(
            handlers_enabled=enabled,
            planning_enabled=planning,
            job_types=types,
            silence_timeout_seconds=_int("SILENCE_ANALYSIS_TIMEOUT_SECONDS", 600, 5, 3600),
            transcript_timeout_seconds=_int("TRANSCRIPT_ANALYSIS_TIMEOUT_SECONDS", 120, 1, 900),
            source_url_ttl_seconds=_int("TRANSCRIPT_ANALYSIS_SOURCE_URL_TTL_SECONDS", 300, 30, 3600),
            source_download_timeout_seconds=_int(
                "TRANSCRIPT_ANALYSIS_SOURCE_DOWNLOAD_TIMEOUT_SECONDS", 120, 5, 900
            ),
            maximum_source_bytes=_int(
                "TRANSCRIPT_ANALYSIS_MAX_SOURCE_BYTES",
                2_000_000_000,
                1_000_000,
                10_000_000_000,
            ),
            maximum_stderr_bytes=_int(
                "SILENCE_ANALYSIS_MAX_STDERR_BYTES", 1_048_576, 65_536, 8_388_608
            ),
            temp_root=Path(
                os.getenv(
                    "TRANSCRIPT_ANALYSIS_TEMP_ROOT",
                    str(Path(tempfile.gettempdir()) / "capinsta-transcript-analysis"),
                )
            ),
            storage_backend=backend,
            local_storage_root=os.getenv("CLIPPING_LOCAL_STORAGE_ROOT", "data/clipping-storage"),
            ffmpeg_path=os.getenv("FFMPEG_PATH", "ffmpeg"),
        )


__all__ = ["TranscriptAnalysisConfig"]
