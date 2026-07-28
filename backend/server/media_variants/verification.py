from __future__ import annotations

import json
import asyncio
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from server.clipping_jobs.errors import ProcessingJobFailure
from server.clipping_storage.models import ProbeSource
from server.media_probe.ffprobe import FFprobeRunner

from .config import MediaVariantConfig
from .contracts import WaveformArtifactV1


def _duration_ms(payload: dict[str, Any]) -> int | None:
    values = [payload.get("format", {}).get("duration")]
    values.extend(stream.get("duration") for stream in payload.get("streams", []))
    for value in values:
        try:
            seconds = Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            continue
        if seconds.is_finite() and seconds >= 0:
            return int(
                (seconds * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            )
    return None


async def probe_output(
    runner: FFprobeRunner,
    path: Path,
    *,
    config: MediaVariantConfig,
) -> dict[str, Any]:
    source = ProbeSource(
        kind="local_path",
        value=str(path),
        expires_at=None,
        redacted_display="[temporary-variant]",
    )

    async def never() -> bool:
        return False

    raw = await runner.run(
        source,
        job_timeout_seconds=max(config.proxy_timeout_seconds, 121),
        cancellation_check=never,
        cancellation_event=asyncio.Event(),
        lease_lost_event=asyncio.Event(),
        stop_event=asyncio.Event(),
    )
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Generated media metadata was invalid",
            retryable=False,
        ) from exc


def verify_proxy(
    payload: dict[str, Any],
    *,
    source_duration_ms: int,
    expect_audio: bool,
    tolerance_ms: int,
) -> dict[str, Any]:
    streams = payload.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if len(videos) != 1 or videos[0].get("codec_name") != "h264":
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Proxy does not contain exactly one H.264 video stream",
            retryable=False,
        )
    width = int(videos[0].get("width") or 0)
    height = int(videos[0].get("height") or 0)
    if width <= 0 or height <= 0 or width > 1280 or height > 720:
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Proxy dimensions are outside the editing preset",
            retryable=False,
        )
    if videos[0].get("pix_fmt") != "yuv420p":
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Proxy pixel format is not yuv420p",
            retryable=False,
        )
    if expect_audio and (
        len(audios) != 1 or audios[0].get("codec_name") != "aac"
    ):
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Proxy audio does not match the editing preset",
            retryable=False,
        )
    if not expect_audio and audios:
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Proxy unexpectedly contains audio",
            retryable=False,
        )
    duration = _duration_ms(payload)
    if duration is None or abs(duration - source_duration_ms) > tolerance_ms:
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Proxy duration differs from the source",
            retryable=False,
        )
    return {
        "durationMs": duration,
        "width": width,
        "height": height,
        "videoCodec": "h264",
        "audioCodec": "aac" if audios else None,
        "pixelFormat": "yuv420p",
        "frameRateMode": "preserve",
    }


def verify_audio(
    payload: dict[str, Any],
    *,
    source_duration_ms: int,
    tolerance_ms: int,
) -> dict[str, Any]:
    streams = payload.get("streams", [])
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    if videos or len(audios) != 1:
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Extracted audio stream layout is invalid",
            retryable=False,
        )
    audio = audios[0]
    if (
        audio.get("codec_name") != "pcm_s16le"
        or int(audio.get("sample_rate") or 0) != 16000
        or int(audio.get("channels") or 0) != 1
    ):
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Extracted audio does not match PCM S16LE 16 kHz mono",
            retryable=False,
        )
    duration = _duration_ms(payload)
    if duration is None or abs(duration - source_duration_ms) > tolerance_ms:
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Extracted audio duration differs from the source",
            retryable=False,
        )
    return {
        "durationMs": duration,
        "audioCodec": "pcm_s16le",
        "sampleRateHz": 16000,
        "channels": 1,
    }


def verify_thumbnail(payload: dict[str, Any]) -> dict[str, Any]:
    streams = payload.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    if len(videos) != 1 or videos[0].get("codec_name") != "mjpeg":
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Thumbnail is not a valid JPEG image",
            retryable=False,
        )
    width = int(videos[0].get("width") or 0)
    height = int(videos[0].get("height") or 0)
    if width <= 0 or height <= 0 or width > 640:
        raise ProcessingJobFailure(
            "variant_verification_failed",
            "Thumbnail dimensions are outside the poster preset",
            retryable=False,
        )
    return {"width": width, "height": height, "imageCodec": "mjpeg"}


def verify_waveform(
    path: Path,
    *,
    source_duration_ms: int,
    maximum_peaks: int,
    maximum_bytes: int,
) -> WaveformArtifactV1:
    if path.stat().st_size <= 0 or path.stat().st_size > maximum_bytes:
        raise ProcessingJobFailure(
            "waveform_invalid",
            "Waveform artifact exceeds its size limit",
            retryable=False,
        )
    try:
        artifact = WaveformArtifactV1.model_validate_json(
            path.read_text(encoding="utf-8")
        )
    except Exception as exc:
        raise ProcessingJobFailure(
            "waveform_invalid",
            "Waveform artifact is invalid",
            retryable=False,
        ) from exc
    if (
        artifact.durationMs != source_duration_ms
        or len(artifact.peaks) > maximum_peaks
    ):
        raise ProcessingJobFailure(
            "waveform_invalid",
            "Waveform duration or peak count is inconsistent",
            retryable=False,
        )
    return artifact


__all__ = [
    "probe_output",
    "verify_audio",
    "verify_proxy",
    "verify_thumbnail",
    "verify_waveform",
]
