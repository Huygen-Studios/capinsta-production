from __future__ import annotations

import hashlib
import json
from typing import Any

from server.clipping_jobs.errors import ProcessingJobFailure

PROXY_SPEC = {
    "schemaVersion": 1,
    "variantType": "proxy",
    "preset": "editing-720p-v1",
    "container": "mp4",
    "videoCodec": "h264",
    "audioCodec": "aac",
    "maximumWidth": 1280,
    "maximumHeight": 720,
    "videoBitRateKbps": 2500,
    "audioBitRateKbps": 128,
    "audioSampleRateHz": 48000,
    "pixelFormat": "yuv420p",
    "fastStart": True,
    "frameRateMode": "preserve",
}
AUDIO_SPEC = {
    "schemaVersion": 1,
    "variantType": "audio_extract",
    "preset": "transcription-wav-16k-mono-v1",
    "container": "wav",
    "audioCodec": "pcm_s16le",
    "sampleRateHz": 16000,
    "channels": 1,
}
THUMBNAIL_SPEC = {
    "schemaVersion": 1,
    "variantType": "thumbnail",
    "preset": "poster-jpeg-v1",
    "format": "jpeg",
    "maximumWidth": 640,
    "quality": 3,
    "timestampStrategy": "min-10-percent-or-5-seconds",
}
WAVEFORM_SPEC = {
    "schemaVersion": 1,
    "variantType": "waveform",
    "preset": "waveform-peaks-v1",
    "format": "json",
    "sampleRateHz": 16000,
    "channelMode": "mono",
    "bucketDurationMs": 10,
    "peakEncoding": "signed-int16-min-max",
    "maximumPeakCount": 200000,
}

PRESETS: dict[str, dict[str, Any]] = {
    spec["preset"]: spec
    for spec in (PROXY_SPEC, AUDIO_SPEC, THUMBNAIL_SPEC, WAVEFORM_SPEC)
}
JOB_TO_PRESET = {
    "proxy_generation": "editing-720p-v1",
    "audio_extraction": "transcription-wav-16k-mono-v1",
    "thumbnail_generation": "poster-jpeg-v1",
    "waveform_generation": "waveform-peaks-v1",
}
JOB_TO_VARIANT = {
    "proxy_generation": "proxy",
    "audio_extraction": "audio_extract",
    "thumbnail_generation": "thumbnail",
    "waveform_generation": "waveform",
}


def canonical_spec_json(spec: dict[str, Any]) -> str:
    return json.dumps(
        spec, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )


def generation_spec_hash(spec: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_spec_json(spec).encode("utf-8")).hexdigest()


def preset_spec(name: str) -> dict[str, Any]:
    try:
        return dict(PRESETS[name])
    except KeyError as exc:
        raise ProcessingJobFailure(
            "variant_spec_mismatch",
            "The media-variant preset is not supported",
            retryable=False,
        ) from exc


__all__ = [
    "AUDIO_SPEC",
    "JOB_TO_PRESET",
    "JOB_TO_VARIANT",
    "PRESETS",
    "PROXY_SPEC",
    "THUMBNAIL_SPEC",
    "WAVEFORM_SPEC",
    "canonical_spec_json",
    "generation_spec_hash",
    "preset_spec",
]
