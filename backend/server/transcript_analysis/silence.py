from __future__ import annotations

import asyncio
import os
import re
import shutil
import signal
import subprocess
from contextlib import suppress
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Awaitable, Callable

from server.clipping_jobs.errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from server.clipping_jobs.models import JobExecutionContext

try:
    from contracts.transcript_document_v2 import TranscriptDocumentV2
except ImportError:
    from backend.contracts.transcript_document_v2 import TranscriptDocumentV2

from .contracts import (
    ProposedActionV1,
    SilenceAnalysisDocumentV1,
    SilenceIntervalV1,
    SilenceSummaryV1,
    TimelineRecommendationV1,
)
from .identity import stable_id

_START = re.compile(r"silence_start:\s*([-+]?[0-9]+(?:\.[0-9]+)?)")
_END = re.compile(
    r"silence_end:\s*([-+]?[0-9]+(?:\.[0-9]+)?)"
    r"\s*\|\s*silence_duration:\s*([-+]?[0-9]+(?:\.[0-9]+)?)"
)


def decimal_seconds_to_ms(value: str) -> int:
    try:
        decimal = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("invalid silence timestamp") from exc
    return int(
        (decimal * Decimal(1000)).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )


def parse_silencedetect(
    stderr: str,
    *,
    duration_ms: int,
    minimum_duration_ms: int,
    merge_gap_ms: int,
) -> tuple[list[SilenceIntervalV1], list[str]]:
    warnings: set[str] = set()
    open_start: int | None = None
    intervals: list[tuple[int, int]] = []
    for line in stderr.splitlines():
        start_match = _START.search(line)
        if start_match:
            start = decimal_seconds_to_ms(start_match.group(1))
            if start < 0 or start > duration_ms:
                raise ValueError("silence start outside media duration")
            if open_start is not None:
                if start == open_start:
                    warnings.add("duplicate_silence_event_ignored")
                    continue
                raise ValueError("out-of-order silence start")
            open_start = start
            continue
        end_match = _END.search(line)
        if not end_match:
            continue
        end = decimal_seconds_to_ms(end_match.group(1))
        detected_duration = decimal_seconds_to_ms(end_match.group(2))
        if end < 0 or end > duration_ms:
            raise ValueError("silence end outside media duration")
        if open_start is None:
            open_start = end - detected_duration
            warnings.add("silence_start_reconstructed")
        if open_start < 0 or end < open_start:
            raise ValueError("contradictory silence event")
        if end == open_start:
            warnings.add("zero_duration_silence_ignored")
        else:
            intervals.append((open_start, end))
        open_start = None
    if open_start is not None:
        if open_start < duration_ms:
            intervals.append((open_start, duration_ms))
            warnings.add("trailing_silence_closed_at_duration")
        else:
            warnings.add("zero_duration_silence_ignored")

    normalized: list[tuple[int, int]] = []
    for start, end in sorted(set(intervals)):
        if end - start < minimum_duration_ms:
            continue
        if normalized and start < normalized[-1][1]:
            raise ValueError("overlapping silence intervals")
        if normalized and start - normalized[-1][1] <= merge_gap_ms:
            normalized[-1] = (normalized[-1][0], max(end, normalized[-1][1]))
            warnings.add("adjacent_silence_intervals_merged")
        else:
            normalized.append((start, end))
    result = [
        SilenceIntervalV1(
            id=f"silence_{index:06d}",
            sourceStartMs=start,
            sourceEndMs=end,
            durationMs=end - start,
            metadata={},
        )
        for index, (start, end) in enumerate(normalized, 1)
    ]
    return result, sorted(warnings)


class SilenceFFmpegRunner:
    def __init__(
        self,
        executable: str = "ffmpeg",
        *,
        maximum_stderr_bytes: int = 1_048_576,
        terminate_grace_seconds: int = 3,
    ) -> None:
        self.executable = shutil.which(executable) or executable
        self.maximum_stderr_bytes = maximum_stderr_bytes
        self.terminate_grace_seconds = terminate_grace_seconds

    @staticmethod
    def _group_options() -> dict[str, object]:
        if os.name == "nt":
            return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        return {"start_new_session": True}

    async def validate_available(self) -> str:
        try:
            process = await asyncio.create_subprocess_exec(
                self.executable,
                "-version",
                "-hide_banner",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **self._group_options(),
            )
            stdout, _ = await asyncio.wait_for(process.communicate(), 5)
        except (OSError, TimeoutError) as exc:
            raise JobOrchestrationError(
                "worker_not_configured",
                "Silence analysis cannot execute FFmpeg",
            ) from exc
        first = stdout.decode("utf-8", errors="replace").splitlines()
        if process.returncode != 0 or not first or not first[0].lower().startswith(
            "ffmpeg version"
        ):
            raise JobOrchestrationError(
                "worker_not_configured",
                "Silence analysis FFmpeg validation failed",
            )
        return first[0][:200]

    async def _terminate(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        with suppress(ProcessLookupError):
            if os.name != "nt" and process.pid:
                os.killpg(process.pid, signal.SIGTERM)
            else:
                process.terminate()
        try:
            await asyncio.wait_for(
                process.wait(), self.terminate_grace_seconds
            )
        except TimeoutError:
            with suppress(ProcessLookupError):
                if os.name != "nt" and process.pid:
                    os.killpg(process.pid, signal.SIGKILL)
                else:
                    process.kill()
            with suppress(Exception):
                await process.wait()

    async def detect(
        self,
        audio_path: Path,
        *,
        context: JobExecutionContext,
        noise_threshold_db: int,
        minimum_duration_ms: int,
        timeout_seconds: int,
    ) -> str:
        filter_value = (
            f"silencedetect=noise={noise_threshold_db}dB:"
            f"d={minimum_duration_ms / 1000:g}"
        )
        try:
            process = await asyncio.create_subprocess_exec(
                self.executable,
                "-hide_banner",
                "-nostdin",
                "-loglevel",
                "info",
                "-i",
                str(audio_path),
                "-af",
                filter_value,
                "-f",
                "null",
                "-",
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
                **self._group_options(),
            )
        except FileNotFoundError as exc:
            raise ProcessingJobFailure(
                "silence_detection_failed",
                "FFmpeg is unavailable for silence analysis",
                retryable=True,
            ) from exc
        assert process.stderr is not None
        async def read_bounded() -> bytes:
            chunks: list[bytes] = []
            size = 0
            while True:
                chunk = await process.stderr.read(16_384)
                if not chunk:
                    return b"".join(chunks)
                size += len(chunk)
                if size > self.maximum_stderr_bytes:
                    raise ProcessingJobFailure(
                        "silence_output_invalid",
                        "Silence analysis output exceeded its safety limit",
                        retryable=False,
                    )
                chunks.append(chunk)

        read_task = asyncio.create_task(read_bounded())
        wait_task = asyncio.create_task(process.wait())
        started = asyncio.get_running_loop().time()
        try:
            while not wait_task.done():
                if context.lease_lost_event.is_set():
                    raise JobOrchestrationError(
                        "job_lease_lost",
                        "Silence analysis lost its job lease",
                    )
                if (
                    context.shutdown_event.is_set()
                    or context.cancellation_event.is_set()
                    or await context.cancellation_callback()
                ):
                    raise asyncio.CancelledError
                if (
                    asyncio.get_running_loop().time() - started
                    >= timeout_seconds
                ):
                    raise ProcessingJobFailure(
                        "analysis_timeout",
                        "Silence analysis exceeded its hard timeout",
                        retryable=True,
                    )
                await asyncio.wait((wait_task, read_task), timeout=0.2)
            data = await read_task
            if process.returncode != 0:
                raise ProcessingJobFailure(
                    "silence_detection_failed",
                    "FFmpeg could not analyze the transcription audio",
                    retryable=False,
                )
            return data.decode("utf-8", errors="replace")
        except BaseException:
            await self._terminate(process)
            raise
        finally:
            for task in (read_task, wait_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(read_task, wait_task, return_exceptions=True)


def silence_recommendations(
    document: SilenceAnalysisDocumentV1,
    transcript: TranscriptDocumentV2,
    *,
    edge_padding_ms: int,
    minimum_retained_speech_ms: int,
) -> tuple[list[TimelineRecommendationV1], list[str]]:
    warnings: set[str] = set()
    recommendations = []
    timed_words = [
        word
        for word in transcript.words
        if word.startMs is not None and word.endMs is not None
    ]
    for interval in document.intervals:
        start = interval.sourceStartMs + edge_padding_ms
        end = interval.sourceEndMs - edge_padding_ms
        if end <= start:
            warnings.add("silence_too_short_after_padding")
            continue
        if document.durationMs - (end - start) < minimum_retained_speech_ms:
            warnings.add("silence_removal_would_remove_too_much")
            continue
        overlap = any(
            int(word.startMs) < end and int(word.endMs) > start
            for word in timed_words
        )
        if overlap:
            warnings.add("silence_overlaps_transcript_word")
            continue
        identity = {
            "analysisId": document.analysisId,
            "intervalId": interval.id,
            "start": start,
            "end": end,
        }
        recommendations.append(
            TimelineRecommendationV1(
                recommendationId=stable_id("rec", identity),
                analysisId=document.analysisId,
                recommendationType="remove_silence",
                sourceStartMs=start,
                sourceEndMs=end,
                wordIds=[],
                segmentIds=[],
                reasonCode="silence_exceeds_threshold",
                severity="suggestion",
                analysisConfidence=None,
                proposedAction=ProposedActionV1(
                    action="exclude_source_interval",
                    paddingBeforeMs=edge_padding_ms,
                    paddingAfterMs=edge_padding_ms,
                ),
                contributingFindingIds=[],
                metadata={"silenceIntervalId": interval.id},
            )
        )
    return recommendations, sorted(warnings)


def build_silence_document(
    *,
    analysis_id: str,
    media_asset_id,
    media_revision: int,
    transcript_id: str,
    transcript_revision: int,
    audio_variant_id,
    audio_variant_revision: int,
    duration_ms: int,
    intervals: list[SilenceIntervalV1],
    warnings: list[str],
) -> SilenceAnalysisDocumentV1:
    durations = [interval.durationMs for interval in intervals]
    return SilenceAnalysisDocumentV1(
        analysisId=analysis_id,
        mediaAssetId=media_asset_id,
        mediaRevision=media_revision,
        transcriptId=transcript_id,
        transcriptRevision=transcript_revision,
        audioVariantId=audio_variant_id,
        audioVariantRevision=audio_variant_revision,
        durationMs=duration_ms,
        preset="speech-silence-v1",
        intervals=intervals,
        summary=SilenceSummaryV1(
            intervalCount=len(intervals),
            totalSilenceMs=sum(durations),
            longestSilenceMs=max(durations, default=0),
        ),
        warnings=sorted(set(warnings)),
        metadata={"detector": "ffmpeg_silencedetect"},
    )


__all__ = [
    "SilenceFFmpegRunner",
    "build_silence_document",
    "decimal_seconds_to_ms",
    "parse_silencedetect",
    "silence_recommendations",
]
