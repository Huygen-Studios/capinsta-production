from __future__ import annotations

import asyncio
from contextlib import suppress

from pydantic import ValidationError

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionResult
from server.clipping_runtime.client import ClippingRuntimeClient
from server.clipping_runtime.errors import ClippingRuntimeError
from server.clipping_storage.errors import StorageError
from server.clipping_storage.storage import MediaStorage
from server.durable_transcription.config import DurableTranscriptionConfig
from server.durable_transcription.source import materialize_transcription_source
from server.media_variants.workspace import temporary_workspace

from .config import AutomaticClipperConfig
from .contracts import (
    AutomaticClipperJobResultV1,
    HookOverlayV1,
    ReframePlanV1,
    SmartReframeJobInputV1,
    TranscriptEvidenceV1,
    ViralCandidateAnalysisDocumentV1,
    ViralCandidateAnalysisJobInputV1,
    ViralCandidateV1,
)
from .identity import canonical_hash
from .provider import ExistingLlmCandidateProvider, bounded_transcript_payload
from .repository import AutomaticClipperRepository
from .vision import detect_faces, detect_scene_boundaries


def _runtime_failure(error: ClippingRuntimeError) -> BaseException:
    if error.code == "clipping_runtime_cancelled":
        return asyncio.CancelledError()
    if error.code == "clipping_runtime_lease_lost":
        return JobOrchestrationError("job_lease_lost", "The runtime job lease was lost")
    return ProcessingJobFailure(error.code, error.safe_message, retryable=error.retryable)


class _BaseHandler:
    input_type = None

    def __init__(self, *, repository: AutomaticClipperRepository) -> None:
        self.repository = repository

    def _input(self, payload):
        try:
            return self.input_type.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "invalid_handler_input", "Automatic clipper job input is invalid"
            ) from exc

    def validate_input(self, payload) -> None:
        self._input(payload)

    @staticmethod
    def validate_output(payload) -> None:
        try:
            AutomaticClipperJobResultV1.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "invalid_handler_output", "Automatic clipper job output is invalid"
            ) from exc

    async def _failure(self, context, value, began, exc):
        if not began or isinstance(exc, (asyncio.CancelledError, JobOrchestrationError)):
            return
        if isinstance(exc, ProcessingJobFailure):
            if not exc.retryable or context.attempt_number >= context.maximum_attempts:
                await self.repository.finalize_failure(context, value, exc)
                raise ProcessingJobFailure(
                    exc.code,
                    exc.safe_message,
                    retryable=False,
                    details={},
                    finalized=True,
                ) from exc


class ViralCandidateAnalysisJobHandler(_BaseHandler):
    job_type = "viral_candidate_analysis"
    input_type = ViralCandidateAnalysisJobInputV1

    def __init__(
        self,
        *,
        config: AutomaticClipperConfig,
        repository: AutomaticClipperRepository,
        runtime: ClippingRuntimeClient,
        provider: ExistingLlmCandidateProvider | None = None,
    ) -> None:
        super().__init__(repository=repository)
        self.config = config
        self.runtime = runtime
        self.provider = provider or ExistingLlmCandidateProvider(
            timeout_seconds=config.provider_timeout_seconds,
            maximum_output_bytes=config.maximum_provider_output_bytes,
        )

    async def execute(self, context, payload):
        value = self._input(payload)
        began = False
        try:
            await context.raise_if_cancelled()
            await context.heartbeat(progress=5, current_stage="loading_transcript")
            (
                _project,
                _asset,
                _transcript_row,
                _analysis,
                transcript,
                _project_document,
                silence,
            ) = await self.repository.begin_analysis(context, value)
            began = True
            transcript_json = transcript.model_dump(mode="json")
            provider_input = bounded_transcript_payload(
                transcript_json, self.config.maximum_provider_input_chars
            )
            await context.heartbeat(progress=20, current_stage="generating_candidates")
            provider = await self.provider.propose(provider_input)
            silence_boundaries = sorted(
                {
                    boundary
                    for interval in (silence or {}).get("intervals", [])
                    for boundary in (
                        interval.get("sourceStartMs"),
                        interval.get("sourceEndMs"),
                    )
                    if isinstance(boundary, int)
                }
            )
            await context.raise_if_cancelled()
            await context.heartbeat(progress=65, current_stage="normalizing_candidates")
            try:
                raw_document, runtime_warnings = await self.runtime.invoke(
                    operation="analyze_candidates",
                    payload={
                        "transcript": transcript_json,
                        "proposals": [
                            item.model_dump(mode="json") for item in provider.proposals
                        ],
                        "silenceBoundariesMs": silence_boundaries,
                        "promptVersion": value.promptVersion,
                        "providerName": provider.name,
                        "providerModel": provider.model,
                        "providerRequestId": provider.request_id,
                    },
                    request_id=f"candidates_{value.analysisId[-32:]}",
                    timeout_seconds=min(
                        self.config.candidate_timeout_seconds,
                        context.execution_timeout_seconds,
                    ),
                    cancellation_check=context.cancellation_callback,
                    cancellation_event=context.cancellation_event,
                    lease_lost_event=context.lease_lost_event,
                    shutdown_event=context.shutdown_event,
                )
            except ClippingRuntimeError as exc:
                raise _runtime_failure(exc) from exc
            try:
                document = ViralCandidateAnalysisDocumentV1.model_validate(
                    raw_document
                )
            except ValidationError as exc:
                raise ProcessingJobFailure(
                    "candidate_result_invalid",
                    "Normalized candidate output is invalid",
                    retryable=False,
                ) from exc
            if provider.used_fallback:
                document.warnings = sorted(
                    set(document.warnings + ["candidate_provider_fallback"])
                )
            document.warnings = sorted(set(document.warnings + list(runtime_warnings)))
            result = AutomaticClipperJobResultV1(
                jobType=self.job_type,
                clipProjectId=value.clipProjectId,
                projectRevision=value.expectedProjectRevision,
                candidateCount=len(document.candidates),
                resultIdentity=canonical_hash(document.model_dump(mode="json")),
                warnings=document.warnings,
            )
            await context.heartbeat(progress=92, current_stage="persisting_candidates")
            output = await self.repository.finalize_analysis(
                context, value, document=document, result=result
            )
            return JobExecutionResult(output=output, finalized=True)
        except BaseException as exc:
            await self._failure(context, value, began, exc)
            raise


class SmartReframeJobHandler(_BaseHandler):
    job_type = "smart_reframe"
    input_type = SmartReframeJobInputV1

    def __init__(
        self,
        *,
        config: AutomaticClipperConfig,
        repository: AutomaticClipperRepository,
        runtime: ClippingRuntimeClient,
        storage: MediaStorage,
        source_ttl_seconds: int,
    ) -> None:
        super().__init__(repository=repository)
        self.config = config
        self.runtime = runtime
        self.storage = storage
        self.source_ttl_seconds = source_ttl_seconds

    async def execute(self, context, payload):
        value = self._input(payload)
        began = False
        try:
            await context.raise_if_cancelled()
            await context.heartbeat(progress=4, current_stage="loading_candidate")
            (
                project,
                asset,
                _transcript,
                candidate_row,
                _document,
                project_document,
                accepted_silences,
            ) = await self.repository.begin_reframe(context, value)
            began = True
            try:
                candidate = ViralCandidateV1.model_validate(
                    candidate_row["candidate"]
                )
            except ValidationError as exc:
                raise ProcessingJobFailure(
                    "candidate_contract_invalid",
                    "Selected candidate is invalid",
                    retryable=False,
                ) from exc
            if not asset.get("width") or not asset.get("height"):
                raise ProcessingJobFailure(
                    "media_dimensions_unavailable",
                    "Smart framing requires probed media dimensions",
                    retryable=False,
                )
            try:
                metadata = await self.storage.inspect_object(
                    bucket=asset["storage_bucket"], path=asset["storage_path"]
                )
                if asset["size_bytes"] and metadata.size_bytes != asset["size_bytes"]:
                    raise ProcessingJobFailure(
                        "media_revision_mismatch",
                        "Source media changed before smart framing",
                        retryable=False,
                    )
                source_context = self.storage.open_probe_source(
                    bucket=asset["storage_bucket"],
                    path=asset["storage_path"],
                    expires_in=self.source_ttl_seconds,
                )
                source_config = DurableTranscriptionConfig(
                    enabled=True,
                    source_url_ttl_seconds=self.source_ttl_seconds,
                    source_download_timeout_seconds=min(
                        300, self.config.reframe_timeout_seconds
                    ),
                    maximum_source_bytes=max(
                        1_000_000, int(asset["size_bytes"] or 2_000_000_000)
                    ),
                )
                async with temporary_workspace(
                    self.config.temp_root,
                    job_id=context.job_id,
                    attempt_number=context.attempt_number,
                    maximum_bytes=max(
                        100_000_000, int(asset["size_bytes"] or 0) * 2
                    ),
                ) as workspace:
                    async with source_context as source:
                        source_path = await materialize_transcription_source(
                            source,
                            context=context,
                            workspace=workspace,
                            config=source_config,
                        )
                    await context.heartbeat(
                        progress=18, current_stage="detecting_scenes"
                    )
                    scenes = await detect_scene_boundaries(
                        source_path,
                        source_start_ms=candidate.sourceStartMs,
                        source_end_ms=candidate.sourceEndMs,
                        ffmpeg_path=self.config.ffmpeg_path,
                        context=context,
                        timeout_seconds=min(
                            self.config.reframe_timeout_seconds,
                            context.execution_timeout_seconds,
                        ),
                    )
                    await context.heartbeat(
                        progress=35, current_stage="detecting_faces"
                    )
                    detections, detector_version = await detect_faces(
                        source_path,
                        source_start_ms=candidate.sourceStartMs,
                        source_end_ms=candidate.sourceEndMs,
                        source_width=asset["width"],
                        source_height=asset["height"],
                        ffmpeg_path=self.config.ffmpeg_path,
                        sample_fps=self.config.frame_sample_fps,
                        maximum_frames=self.config.maximum_sample_frames,
                        model_path=self.config.face_model_path,
                        scene_boundaries_ms=scenes,
                        context=context,
                        timeout_seconds=min(
                            self.config.reframe_timeout_seconds,
                            context.execution_timeout_seconds,
                        ),
                    )
            except StorageError as exc:
                raise ProcessingJobFailure(
                    "smart_reframe_source_unavailable",
                    "Source media is unavailable for smart framing",
                    retryable=exc.category != "storage_permission_denied",
                ) from exc
            await context.raise_if_cancelled()
            await context.heartbeat(progress=65, current_stage="planning_reframe")
            try:
                raw_plan, runtime_warnings = await self.runtime.invoke(
                    operation="plan_reframe",
                    payload={
                        "candidateId": candidate.candidateId,
                        "sourceStartMs": candidate.sourceStartMs,
                        "sourceEndMs": candidate.sourceEndMs,
                        "sourceWidth": asset["width"],
                        "sourceHeight": asset["height"],
                        "sceneBoundariesMs": scenes,
                        "detections": [
                            item.model_dump(mode="json") for item in detections
                        ],
                        "detectorVersion": detector_version,
                    },
                    request_id=f"reframe_{candidate.candidateId[-32:]}",
                    timeout_seconds=min(
                        self.config.reframe_timeout_seconds,
                        context.execution_timeout_seconds,
                    ),
                    cancellation_check=context.cancellation_callback,
                    cancellation_event=context.cancellation_event,
                    lease_lost_event=context.lease_lost_event,
                    shutdown_event=context.shutdown_event,
                )
            except ClippingRuntimeError as exc:
                raise _runtime_failure(exc) from exc
            if value.selection.framingStrategy != "automatic":
                for shot in raw_plan.get("shots", []):
                    shot["strategy"] = value.selection.framingStrategy
                    shot["reasonCode"] = "user_override"
                    if value.selection.framingStrategy != "single_subject_crop":
                        shot["cropKeyframes"] = []
                    if value.selection.framingStrategy == "dual_subject_split":
                        shot["layoutRegions"] = [
                            {
                                "id": "manual_subject_1",
                                "role": "subject_1",
                                "sourceCenterX": 0.3,
                                "sourceCenterY": 0.45,
                                "outputCenterX": 0.5,
                                "outputCenterY": 0.25,
                                "outputWidth": 1.0,
                                "outputHeight": 0.5,
                            },
                            {
                                "id": "manual_subject_2",
                                "role": "subject_2",
                                "sourceCenterX": 0.7,
                                "sourceCenterY": 0.45,
                                "outputCenterX": 0.5,
                                "outputCenterY": 0.75,
                                "outputWidth": 1.0,
                                "outputHeight": 0.5,
                            },
                        ]
                    elif value.selection.framingStrategy == "speaker_screen_stack":
                        shot["layoutRegions"] = [
                            {
                                "id": "manual_screen",
                                "role": "screen",
                                "sourceCenterX": 0.5,
                                "sourceCenterY": 0.5,
                                "outputCenterX": 0.5,
                                "outputCenterY": 0.3,
                                "outputWidth": 1.0,
                                "outputHeight": 0.6,
                            },
                            {
                                "id": "manual_speaker",
                                "role": "speaker",
                                "sourceCenterX": 0.25,
                                "sourceCenterY": 0.45,
                                "outputCenterX": 0.5,
                                "outputCenterY": 0.8,
                                "outputWidth": 1.0,
                                "outputHeight": 0.4,
                            },
                        ]
                    else:
                        shot["layoutRegions"] = []
            try:
                plan = ReframePlanV1.model_validate(raw_plan)
            except ValidationError as exc:
                raise ProcessingJobFailure(
                    "reframe_result_invalid",
                    "Smart framing returned an invalid plan",
                    retryable=False,
                ) from exc
            hook_text = (
                value.selection.hookText
                if value.selection.hookText is not None
                else candidate.hookText or candidate.title
            )
            emojis = (
                value.selection.supportingEmojis
                if value.selection.supportingEmojis is not None
                else candidate.supportingEmojis
            )
            hook = HookOverlayV1(
                text=hook_text,
                supportingEmojis=emojis,
                startMs=0,
                endMs=min(5_000, candidate.durationMs),
                position="top",
                maximumLines=2,
                stylePreset="hook-bold-v1",
                animationPreset="pop",
                safeZoneProfile=value.selection.safeZoneProfile,
                transcriptEvidence=TranscriptEvidenceV1.model_validate(
                    candidate.transcriptEvidence.model_dump(mode="json")
                ),
            )
            await context.heartbeat(progress=78, current_stage="composing_project")
            try:
                raw_composition, composition_warnings = await self.runtime.invoke(
                    operation="compose_short",
                    payload={
                        "baseProject": project_document.model_dump(mode="json"),
                        "candidate": candidate.model_dump(mode="json"),
                        "reframePlan": plan.model_dump(mode="json"),
                        "hookOverlay": hook.model_dump(mode="json"),
                        "captionPreset": value.selection.captionPreset,
                        "wordSpacing": value.selection.wordSpacing,
                        "expectedRevision": value.expectedProjectRevision,
                        "acceptedSilenceIntervals": accepted_silences,
                    },
                    request_id=f"compose_{candidate.candidateId[-32:]}",
                    timeout_seconds=min(
                        120, context.execution_timeout_seconds
                    ),
                    cancellation_check=context.cancellation_callback,
                    cancellation_event=context.cancellation_event,
                    lease_lost_event=context.lease_lost_event,
                    shutdown_event=context.shutdown_event,
                )
            except ClippingRuntimeError as exc:
                raise _runtime_failure(exc) from exc
            identity = canonical_hash(raw_composition)
            warnings = sorted(
                set(
                    runtime_warnings
                    + composition_warnings
                    + tuple(plan.warnings)
                )
            )
            await context.heartbeat(progress=94, current_stage="persisting_composition")
            output = await self.repository.finalize_composition(
                context,
                value,
                reframe_plan=plan,
                project_document=raw_composition["project"],
                composition_report=raw_composition["compositionReport"],
                result_identity=identity,
                warnings=warnings,
            )
            return JobExecutionResult(output=output, finalized=True)
        except BaseException as exc:
            await self._failure(context, value, began, exc)
            raise


__all__ = [
    "SmartReframeJobHandler",
    "ViralCandidateAnalysisJobHandler",
]
