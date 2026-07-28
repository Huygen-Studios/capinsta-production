from __future__ import annotations

import asyncio
import multiprocessing
from contextlib import suppress
from typing import Any

from pydantic import ValidationError

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext, JobExecutionResult
from server.clipping_storage.errors import StorageError
from server.clipping_storage.storage import MediaStorage
from server.durable_transcription.config import DurableTranscriptionConfig
from server.durable_transcription.source import materialize_transcription_source
from server.media_variants.workspace import temporary_workspace

from .config import TranscriptAnalysisConfig
from .contracts import (
    AnalysisJobResultV1,
    SilenceAnalysisJobInputV1,
    TimelineRecommendationV1,
    TranscriptAnalysisDocumentV1,
    TranscriptAnalysisJobInputV1,
)
from .identity import result_identity
from .presets import (
    SILENCE_SPEC,
    SILENCE_SPEC_HASH,
    TRANSCRIPT_REVIEW_SPEC,
    TRANSCRIPT_REVIEW_SPEC_HASH,
)
from .repository import TranscriptAnalysisRepository
from .silence import (
    SilenceFFmpegRunner,
    build_silence_document,
    parse_silencedetect,
    silence_recommendations,
)
from .transcript_review import analyze_transcript


def _transcript_analysis_process(connection, payload: dict[str, Any]) -> None:
    try:
        try:
            from contracts.transcript_document_v2 import TranscriptDocumentV2
        except ImportError:
            from backend.contracts.transcript_document_v2 import TranscriptDocumentV2
        document, recommendations = analyze_transcript(
            TranscriptDocumentV2.model_validate(payload["transcript"]),
            **payload["arguments"],
        )
        connection.send(
            {
                "document": document.model_dump(mode="json"),
                "recommendations": [
                    item.model_dump(mode="json") for item in recommendations
                ],
            }
        )
    except BaseException:
        connection.send({"error": "analysis_result_invalid"})
    finally:
        connection.close()


async def _run_cpu_process(
    context: JobExecutionContext, payload: dict[str, Any], timeout: int
):
    process_context = multiprocessing.get_context("spawn")
    parent, child = process_context.Pipe(duplex=False)
    process = process_context.Process(
        target=_transcript_analysis_process,
        args=(child, payload),
        daemon=True,
    )
    process.start()
    child.close()
    started = asyncio.get_running_loop().time()
    try:
        while process.is_alive():
            if context.lease_lost_event.is_set():
                raise JobOrchestrationError("job_lease_lost", "The analysis job lease was lost")
            if (
                context.shutdown_event.is_set()
                or context.cancellation_event.is_set()
                or await context.cancellation_callback()
            ):
                raise asyncio.CancelledError
            if asyncio.get_running_loop().time() - started >= timeout:
                raise ProcessingJobFailure(
                    "analysis_timeout", "Transcript analysis exceeded its hard timeout", retryable=True
                )
            await asyncio.sleep(0.1)
        await asyncio.to_thread(process.join, 1)
        if process.exitcode != 0 or not parent.poll():
            raise ProcessingJobFailure(
                "analysis_result_invalid",
                "Transcript analysis did not produce a valid result",
                retryable=False,
            )
        result = parent.recv()
        if "error" in result:
            raise ProcessingJobFailure(
                "analysis_result_invalid",
                "Transcript analysis did not produce a valid result",
                retryable=False,
            )
        return (
            TranscriptAnalysisDocumentV1.model_validate(result["document"]),
            [
                TimelineRecommendationV1.model_validate(item)
                for item in result["recommendations"]
            ],
        )
    except BaseException:
        if process.is_alive():
            process.terminate()
        await asyncio.to_thread(process.join, 3)
        if process.is_alive():
            process.kill()
            await asyncio.to_thread(process.join, 3)
        raise
    finally:
        parent.close()


class _Base:
    input_type = None

    def __init__(self, *, config: TranscriptAnalysisConfig, repository: TranscriptAnalysisRepository) -> None:
        self.config = config
        self.repository = repository

    def _input(self, payload):
        try:
            return self.input_type.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError("invalid_handler_input", "The analysis input contract is invalid") from exc

    def validate_input(self, payload: dict[str, Any]) -> None:
        self._input(payload)

    def validate_output(self, payload: dict[str, Any]) -> None:
        try:
            AnalysisJobResultV1.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError("invalid_handler_output", "The analysis output contract is invalid") from exc

    async def _failure(self, context, value, began, exc):
        if not began:
            return
        if isinstance(exc, asyncio.CancelledError):
            with suppress(JobOrchestrationError):
                await self.repository.release_after_cancellation(context, value)
            return
        if isinstance(exc, ProcessingJobFailure):
            if not exc.retryable or context.attempt_number >= context.maximum_attempts:
                await self.repository.finalize_permanent_failure(context, value, exc)
                raise ProcessingJobFailure(
                    exc.code, exc.safe_message, retryable=False, details={}, finalized=True
                ) from exc


class TranscriptAnalysisJobHandler(_Base):
    job_type = "transcript_analysis"
    input_type = TranscriptAnalysisJobInputV1

    async def execute(self, context, payload):
        value = self._input(payload)
        began = False
        try:
            if value.analysisSpecHash != TRANSCRIPT_REVIEW_SPEC_HASH:
                raise ProcessingJobFailure("analysis_spec_mismatch", "The transcript analysis preset is invalid", retryable=False)
            await context.raise_if_cancelled()
            await context.heartbeat(progress=5, current_stage="resolving_transcript")
            _, _, _, _, transcript = await self.repository.begin(context, value)
            began = True
            await context.raise_if_cancelled()
            await context.heartbeat(progress=25, current_stage="analyzing_transcript")

            document, recommendations = await _run_cpu_process(
                context,
                {
                    "transcript": transcript.model_dump(mode="json"),
                    "arguments": {
                        "analysis_id": value.analysisId,
                        "media_asset_id": value.mediaAssetId,
                        "media_revision": value.expectedMediaRevision,
                        "transcript_revision": value.expectedTranscriptRevision,
                        "kinds": value.analysisKinds,
                        "confidence_threshold": TRANSCRIPT_REVIEW_SPEC["wordConfidenceThreshold"],
                        "merge_gap_ms": TRANSCRIPT_REVIEW_SPEC["regionMergeGapMs"],
                        "boundary_ms": TRANSCRIPT_REVIEW_SPEC["timingBoundaryToleranceMs"],
                    },
                },
                min(self.config.transcript_timeout_seconds, context.execution_timeout_seconds),
            )
            await context.raise_if_cancelled()
            await self.repository.mark_normalizing(context, value)
            await context.heartbeat(progress=90, current_stage="persisting_analysis")
            payload_document = document.model_dump(mode="json")
            rec_payload = [item.model_dump(mode="json") for item in recommendations]
            result = AnalysisJobResultV1(
                analysisId=value.analysisId,
                analysisType="transcript_review",
                mediaAssetId=value.mediaAssetId,
                transcriptId=value.transcriptId,
                findingCount=len(document.findings),
                recommendationCount=len(recommendations),
                resultIdentity=result_identity(payload_document, rec_payload),
                warnings=document.warnings,
                metadata={},
            )
            output = await self.repository.finalize_success(
                context, value, document=payload_document, recommendations=recommendations, result=result
            )
            return JobExecutionResult(output=output, finalized=True)
        except BaseException as exc:
            await self._failure(context, value, began, exc)
            raise


class SilenceAnalysisJobHandler(_Base):
    job_type = "silence_analysis"
    input_type = SilenceAnalysisJobInputV1

    def __init__(
        self,
        *,
        config: TranscriptAnalysisConfig,
        repository: TranscriptAnalysisRepository,
        storage: MediaStorage,
        runner: SilenceFFmpegRunner | None = None,
    ) -> None:
        super().__init__(config=config, repository=repository)
        self.storage = storage
        self.runner = runner or SilenceFFmpegRunner(
            config.ffmpeg_path, maximum_stderr_bytes=config.maximum_stderr_bytes
        )

    async def execute(self, context, payload):
        value = self._input(payload)
        began = False
        try:
            if value.analysisSpecHash != SILENCE_SPEC_HASH:
                raise ProcessingJobFailure("analysis_spec_mismatch", "The silence analysis preset is invalid", retryable=False)
            await context.raise_if_cancelled()
            await context.heartbeat(progress=3, current_stage="resolving_audio")
            asset, _, _, variant, transcript = await self.repository.begin(context, value)
            began = True
            try:
                metadata = await self.storage.inspect_object(
                    bucket=variant["storage_bucket"], path=variant["storage_path"]
                )
                if variant["size_bytes"] is not None and metadata.size_bytes != variant["size_bytes"]:
                    raise ProcessingJobFailure("audio_variant_revision_mismatch", "The audio object changed", retryable=False)
                source_context = self.storage.open_probe_source(
                    bucket=variant["storage_bucket"],
                    path=variant["storage_path"],
                    expires_in=self.config.source_url_ttl_seconds,
                )
                source_config = DurableTranscriptionConfig(
                    enabled=True,
                    source_url_ttl_seconds=self.config.source_url_ttl_seconds,
                    source_download_timeout_seconds=self.config.source_download_timeout_seconds,
                    maximum_source_bytes=self.config.maximum_source_bytes,
                )
                async with temporary_workspace(
                    self.config.temp_root,
                    job_id=context.job_id,
                    attempt_number=context.attempt_number,
                    maximum_bytes=min(
                        self.config.maximum_source_bytes,
                        max(100_000_000, int(variant["size_bytes"] or 0) * 3),
                    ),
                ) as workspace:
                    async with source_context as source:
                        audio_path = await materialize_transcription_source(
                            source, context=context, workspace=workspace, config=source_config
                        )
                    await context.heartbeat(progress=25, current_stage="detecting_silence")
                    raw = await self.runner.detect(
                        audio_path,
                        context=context,
                        noise_threshold_db=SILENCE_SPEC["noiseThresholdDb"],
                        minimum_duration_ms=SILENCE_SPEC["minimumSilenceDurationMs"],
                        timeout_seconds=min(
                            self.config.silence_timeout_seconds,
                            context.execution_timeout_seconds,
                        ),
                    )
            except StorageError as exc:
                raise ProcessingJobFailure(
                    "silence_source_unavailable",
                    "The silence-analysis audio is unavailable",
                    retryable=exc.category != "storage_permission_denied",
                ) from exc
            try:
                intervals, warnings = parse_silencedetect(
                    raw,
                    duration_ms=transcript.durationMs,
                    minimum_duration_ms=SILENCE_SPEC["minimumSilenceDurationMs"],
                    merge_gap_ms=SILENCE_SPEC["mergeGapMs"],
                )
                document = build_silence_document(
                    analysis_id=value.analysisId,
                    media_asset_id=value.mediaAssetId,
                    media_revision=value.expectedMediaRevision,
                    transcript_id=value.transcriptId,
                    transcript_revision=value.expectedTranscriptRevision,
                    audio_variant_id=value.audioVariantId,
                    audio_variant_revision=value.expectedAudioVariantRevision,
                    duration_ms=transcript.durationMs,
                    intervals=intervals,
                    warnings=warnings,
                )
                recommendations, recommendation_warnings = silence_recommendations(
                    document,
                    transcript,
                    edge_padding_ms=SILENCE_SPEC["edgePaddingMs"],
                    minimum_retained_speech_ms=SILENCE_SPEC["minimumRetainedSpeechMs"],
                )
                document.warnings = sorted(set(document.warnings + recommendation_warnings))
                document = type(document).model_validate(document.model_dump(mode="json"))
            except (ValidationError, ValueError) as exc:
                raise ProcessingJobFailure("silence_output_invalid", "Silence output was malformed", retryable=False) from exc
            await context.raise_if_cancelled()
            await self.repository.mark_normalizing(context, value)
            payload_document = document.model_dump(mode="json")
            rec_payload = [item.model_dump(mode="json") for item in recommendations]
            result = AnalysisJobResultV1(
                analysisId=value.analysisId,
                analysisType="silence",
                mediaAssetId=value.mediaAssetId,
                transcriptId=value.transcriptId,
                findingCount=len(document.intervals),
                recommendationCount=len(recommendations),
                resultIdentity=result_identity(payload_document, rec_payload),
                warnings=document.warnings,
                metadata={},
            )
            output = await self.repository.finalize_success(
                context, value, document=payload_document, recommendations=recommendations, result=result
            )
            return JobExecutionResult(output=output, finalized=True)
        except BaseException as exc:
            await self._failure(context, value, began, exc)
            raise


__all__ = ["SilenceAnalysisJobHandler", "TranscriptAnalysisJobHandler"]
