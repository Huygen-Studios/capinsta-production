from __future__ import annotations

import array
import json
import sys
from pathlib import Path
from typing import BinaryIO
from uuid import UUID

from server.clipping_jobs.errors import ProcessingJobFailure

from .contracts import WaveformArtifactV1


def compute_peak_pairs(
    stream: BinaryIO,
    *,
    samples_per_bucket: int,
    maximum_peaks: int,
) -> list[tuple[int, int]]:
    peaks: list[tuple[int, int]] = []
    pending = array.array("h")
    while True:
        chunk = stream.read(65_536)
        if not chunk:
            break
        if len(chunk) % 2:
            raise ProcessingJobFailure(
                "waveform_invalid",
                "Decoded waveform PCM was not aligned to signed 16-bit samples",
                retryable=False,
            )
        values = array.array("h")
        values.frombytes(chunk)
        if sys.byteorder != "little":  # pragma: no cover - CI is little-endian
            values.byteswap()
        if values.itemsize != 2:
            raise ProcessingJobFailure(
                "waveform_invalid",
                "Signed 16-bit PCM is unavailable",
                retryable=False,
            )
        pending.extend(values)
        while len(pending) >= samples_per_bucket:
            bucket = pending[:samples_per_bucket]
            del pending[:samples_per_bucket]
            peaks.append((min(bucket), max(bucket)))
            if len(peaks) > maximum_peaks:
                raise ProcessingJobFailure(
                    "waveform_invalid",
                    "Waveform exceeds the configured peak-count limit",
                    retryable=False,
                )
    if pending:
        peaks.append((min(pending), max(pending)))
    return peaks


def write_waveform_artifact(
    pcm_path: Path,
    output_path: Path,
    *,
    media_asset_id: UUID,
    source_revision: int,
    duration_ms: int,
    bucket_duration_ms: int,
    maximum_peaks: int,
) -> WaveformArtifactV1:
    with pcm_path.open("rb") as stream:
        peaks = compute_peak_pairs(
            stream,
            samples_per_bucket=16_000 * bucket_duration_ms // 1000,
            maximum_peaks=maximum_peaks,
        )
    artifact = WaveformArtifactV1(
        mediaAssetId=media_asset_id,
        sourceMediaRevision=source_revision,
        durationMs=duration_ms,
        bucketDurationMs=bucket_duration_ms,
        peaks=peaks,
    )
    output_path.write_text(
        json.dumps(
            artifact.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    return artifact


__all__ = ["compute_peak_pairs", "write_waveform_artifact"]
