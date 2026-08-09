from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class JobTypePolicy:
    maximum_attempts: int
    default_timeout_seconds: int
    lease_seconds: int
    heartbeat_seconds: int
    priority: int = 0
    retryable_error_codes: frozenset[str] = frozenset(
        {
            "processor_temporarily_unavailable",
            "processor_timeout",
            "database_temporarily_unavailable",
            "worker_lease_expired",
        }
    )


DEFAULT_JOB_POLICIES: dict[str, JobTypePolicy] = {
    "media_probe": JobTypePolicy(
        3,
        120,
        90,
        30,
        20,
        frozenset(
            {
                "storage_provider_unavailable",
                "probe_source_unavailable",
                "ffprobe_start_failed",
                "ffprobe_timeout",
                "database_temporarily_unavailable",
                "worker_lease_expired",
            }
        ),
    ),
    "proxy_generation": JobTypePolicy(
        3,
        1860,
        120,
        30,
        10,
        frozenset(
            {
                "variant_upload_failed",
                "source_media_not_ready",
                "ffmpeg_start_failed",
                "ffmpeg_timeout",
                "temporary_storage_unavailable",
                "temporary_disk_limit_exceeded",
                "database_temporarily_unavailable",
                "worker_lease_expired",
            }
        ),
    ),
    "audio_extraction": JobTypePolicy(
        3,
        1860,
        120,
        30,
        10,
        frozenset(
            {
                "variant_upload_failed",
                "source_media_not_ready",
                "ffmpeg_start_failed",
                "ffmpeg_timeout",
                "temporary_storage_unavailable",
                "temporary_disk_limit_exceeded",
                "database_temporarily_unavailable",
                "worker_lease_expired",
            }
        ),
    ),
    "thumbnail_generation": JobTypePolicy(
        3,
        150,
        90,
        30,
        10,
        frozenset(
            {
                "variant_upload_failed",
                "source_media_not_ready",
                "ffmpeg_start_failed",
                "ffmpeg_timeout",
                "temporary_storage_unavailable",
                "database_temporarily_unavailable",
                "worker_lease_expired",
            }
        ),
    ),
    "waveform_generation": JobTypePolicy(
        3,
        1860,
        120,
        30,
        10,
        frozenset(
            {
                "variant_upload_failed",
                "source_media_not_ready",
                "ffmpeg_start_failed",
                "ffmpeg_timeout",
                "temporary_storage_unavailable",
                "temporary_disk_limit_exceeded",
                "database_temporarily_unavailable",
                "worker_lease_expired",
            }
        ),
    ),
    "transcription": JobTypePolicy(3, 7200, 120, 30, 10),
    "transcript_analysis": JobTypePolicy(
        3, 120, 90, 30, 5,
        frozenset({"analysis_timeout", "database_temporarily_unavailable", "worker_lease_expired"}),
    ),
    "silence_analysis": JobTypePolicy(
        3, 600, 90, 30, 5,
        frozenset({
            "analysis_timeout", "silence_source_unavailable",
            "silence_detection_failed", "database_temporarily_unavailable",
            "worker_lease_expired",
        }),
    ),
    "highlight_analysis": JobTypePolicy(3, 1800, 90, 30, 5),
    "viral_candidate_analysis": JobTypePolicy(
        3,
        300,
        90,
        30,
        5,
        frozenset(
            {
                "candidate_provider_timeout",
                "candidate_provider_unavailable",
                "clipping_runtime_timeout",
                "clipping_runtime_start_failed",
                "database_temporarily_unavailable",
                "worker_lease_expired",
            }
        ),
    ),
    "smart_reframe": JobTypePolicy(
        2,
        900,
        120,
        30,
        8,
        frozenset(
            {
                "smart_reframe_unavailable",
                "smart_reframe_timeout",
                "smart_reframe_source_unavailable",
                "clipping_runtime_timeout",
                "clipping_runtime_start_failed",
                "database_temporarily_unavailable",
                "worker_lease_expired",
            }
        ),
    ),
    "clip_export": JobTypePolicy(3, 7200, 120, 30, 10),
    "caption_export": JobTypePolicy(3, 7200, 120, 30, 10),
    "editor_export": JobTypePolicy(2, 7200, 120, 30, 10),
    "project_conversion": JobTypePolicy(2, 300, 90, 30, 15),
    "project_derivation": JobTypePolicy(2, 300, 90, 30, 15),
}


@dataclass(frozen=True)
class RetryBackoff:
    base_seconds: int = 10
    multiplier: float = 2.0
    maximum_seconds: int = 900
    jitter_percent: int = 20

    def delay_seconds(
        self,
        attempt_count: int,
        *,
        random_value: Callable[[], float] = random.random,
    ) -> float:
        exponent = max(0, attempt_count - 1)
        base = min(
            self.base_seconds * (self.multiplier**exponent),
            self.maximum_seconds,
        )
        if self.jitter_percent == 0 or base == 0:
            return float(base)
        spread = base * self.jitter_percent / 100
        return max(0.0, min(self.maximum_seconds, base - spread + 2 * spread * random_value()))
