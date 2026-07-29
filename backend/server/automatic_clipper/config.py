from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from server.clipping_jobs.errors import JobOrchestrationError


def _enabled(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() in {"1", "true", "yes", "on"}


def _integer(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise JobOrchestrationError(
            "worker_not_configured", f"{name} must be an integer"
        ) from exc
    if not low <= value <= high:
        raise JobOrchestrationError(
            "worker_not_configured", f"{name} must be between {low} and {high}"
        )
    return value


@dataclass(frozen=True)
class AutomaticClipperConfig:
    candidate_analysis_enabled: bool = False
    smart_reframe_enabled: bool = False
    provider_timeout_seconds: int = 90
    candidate_timeout_seconds: int = 180
    reframe_timeout_seconds: int = 600
    maximum_provider_input_chars: int = 28_000
    maximum_provider_output_bytes: int = 256_000
    maximum_sample_frames: int = 180
    frame_sample_fps: int = 2
    face_model_path: Path = (
        Path(__file__).resolve().parents[2]
        / "assets/mediapipe/blaze_face_short_range-float16-v1.tflite"
    )
    ffmpeg_path: str = "ffmpeg"
    temp_root: Path = Path("data/automatic-clipper-worker")
    storage_backend: str = "supabase"
    local_storage_root: Path = Path("data/clipping-storage")

    @classmethod
    def from_env(cls) -> "AutomaticClipperConfig":
        config = cls(
            candidate_analysis_enabled=_enabled(
                "ENABLE_VIRAL_CANDIDATE_ANALYSIS"
            ),
            smart_reframe_enabled=_enabled("ENABLE_SMART_REFRAME"),
            provider_timeout_seconds=_integer(
                "VIRAL_CANDIDATE_PROVIDER_TIMEOUT_SECONDS", 90, 5, 600
            ),
            candidate_timeout_seconds=_integer(
                "VIRAL_CANDIDATE_JOB_TIMEOUT_SECONDS", 180, 10, 1800
            ),
            reframe_timeout_seconds=_integer(
                "SMART_REFRAME_JOB_TIMEOUT_SECONDS", 600, 10, 3600
            ),
            maximum_provider_input_chars=_integer(
                "VIRAL_CANDIDATE_MAX_INPUT_CHARS", 28_000, 1_000, 100_000
            ),
            maximum_provider_output_bytes=_integer(
                "VIRAL_CANDIDATE_MAX_OUTPUT_BYTES", 256_000, 10_000, 1_000_000
            ),
            maximum_sample_frames=_integer(
                "SMART_REFRAME_MAX_SAMPLE_FRAMES", 180, 1, 1_000
            ),
            frame_sample_fps=_integer("SMART_REFRAME_SAMPLE_FPS", 2, 1, 5),
            face_model_path=Path(
                os.getenv(
                    "SMART_REFRAME_FACE_MODEL_PATH",
                    str(
                        Path(__file__).resolve().parents[2]
                        / "assets/mediapipe/blaze_face_short_range-float16-v1.tflite"
                    ),
                )
            ),
            ffmpeg_path=(os.getenv("FFMPEG_PATH") or "ffmpeg").strip(),
            temp_root=Path(
                os.getenv(
                    "AUTOMATIC_CLIPPER_TEMP_ROOT",
                    "data/automatic-clipper-worker",
                )
            ),
            storage_backend=os.getenv(
                "AUTOMATIC_CLIPPER_STORAGE_BACKEND", "supabase"
            ).strip().lower(),
            local_storage_root=Path(
                os.getenv("CLIPPING_LOCAL_STORAGE_ROOT", "data/clipping-storage")
            ),
        )
        if config.storage_backend not in {"local", "supabase", "r2"}:
            raise JobOrchestrationError(
                "worker_not_configured",
                "AUTOMATIC_CLIPPER_STORAGE_BACKEND must be local, supabase, or r2",
            )
        return config
