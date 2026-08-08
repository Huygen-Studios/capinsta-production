from __future__ import annotations

import json
import math
import os
import struct
import tempfile
import wave
from pathlib import Path

from ai_pipeline.timing import alignment_provider_status, detect_silence_gaps


def _write_tiny_wav(path: Path) -> None:
    sample_rate = 16000
    duration_seconds = 0.35
    total_samples = int(sample_rate * duration_seconds)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        frames = bytearray()
        for index in range(total_samples):
            # A tiny low-amplitude tone is enough to exercise audio decode and
            # model inference. Speech detection itself is not asserted here.
            sample = int(800 * math.sin(2 * math.pi * 440 * (index / sample_rate)))
            frames.extend(struct.pack("<h", sample))
        wav_file.writeframes(bytes(frames))


def run_smoke() -> dict[str, object]:
    os.environ["ENABLE_SILERO_VAD"] = "true"
    status = alignment_provider_status()
    if not status.get("sileroVadImportable"):
        raise RuntimeError(f"silero_vad_import_failed: {status.get('sileroVadImportError') or 'not importable'}")
    if not status.get("torchAvailable"):
        raise RuntimeError("silero_vad_torch_missing")

    with tempfile.TemporaryDirectory(prefix="capinsta-silero-smoke-") as tmp_dir:
        wav_path = Path(tmp_dir) / "tiny.wav"
        _write_tiny_wav(wav_path)
        report = detect_silence_gaps(
            str(wav_path),
            min_silence=0.25,
            silero_enabled=True,
            silero_speech_threshold=0.5,
            silero_min_speech_duration_ms=80,
            silero_min_silence_duration_ms=180,
            silero_speech_pad_ms=30,
        )

    if report.get("provider") != "silero_vad":
        raise RuntimeError(f"silero_vad_provider_unavailable: {report.get('provider')} error={report.get('sileroError') or report.get('error')}")
    if report.get("pauseDetectionProvider") != "silero":
        raise RuntimeError(f"pauseDetectionProvider={report.get('pauseDetectionProvider')}")
    if report.get("pauseDetectionDegraded"):
        raise RuntimeError("pauseDetectionDegraded=true")

    return {
        "sileroVadSmoke": "passed",
        "pauseDetectionProvider": report.get("pauseDetectionProvider"),
        "pauseDetectionDegraded": report.get("pauseDetectionDegraded"),
        "audioDuration": report.get("audioDuration"),
        "rawSpeechRangeCount": len(report.get("rawSpeechRanges") or []),
        "hardSpeechGapCount": len(report.get("hardSpeechGaps") or []),
        "sileroVadVersion": status.get("sileroVadVersion"),
        "torchVersion": status.get("torchVersion"),
    }


def main() -> int:
    print(json.dumps(run_smoke(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
