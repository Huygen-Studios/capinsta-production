from __future__ import annotations

import asyncio
import copy
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from server.clipping_jobs.errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from server.clipping_jobs.models import JobExecutionContext, JobExecutionResult
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.errors import StorageError
from server.clipping_storage.provider import media_storage_for_provider
from server.clipping_storage.storage import MediaStorage
from server.media_variants.workspace import temporary_workspace
from server.transcription_control import TranscriptionConfigSnapshot

try:
    from contracts.transcript_document_v2 import TranscriptDocumentV2
except ImportError:
    from backend.contracts.transcript_document_v2 import TranscriptDocumentV2

from .config import DurableTranscriptionConfig
from .contracts import (
    LanguageSummaryV1,
    ProviderSummaryV1,
    TranscriptionJobInputV1,
    TranscriptionJobResultV1,
)
from .identity import transcript_result_identity, validate_request_identity
from .normalization import (
    build_transcript_document_v2,
    summarize_timing_source,
)
from .pipeline import ExistingTranscriptionPipeline, TranscriptionPipeline
from .repository import DurableTranscriptionRepository
from .source import materialize_transcription_source


def _storage_failure(exc: StorageError) -> ProcessingJobFailure:
    mapping = {
        "object_not_found": (
            "transcription_source_unavailable",
            "The transcription audio object is unavailable",
            True,
        ),
        "storage_provider_unavailable": (
            "transcription_source_unavailable",
            "Private media storage is temporarily unavailable",
            True,
        ),
        "signed_url_failed": (
            "transcription_source_authorization_failed",
            "The transcription audio could not be authorized",
            True,
        ),
        "storage_permission_denied": (
            "transcription_source_authorization_failed",
            "The transcription worker was denied Storage access",
            False,
        ),
    }
    code, message, retryable = mapping.get(
        exc.category,
        (
            "transcription_source_unavailable",
            "The transcription audio is unavailable",
            True,
        ),
    )
    return ProcessingJobFailure(code, message, retryable=retryable)


def _result_for_document(
    *,
    document: TranscriptDocumentV2,
    job_input: TranscriptionJobInputV1,
    warnings: list[str],
) -> TranscriptionJobResultV1:
    timed_words = sum(
        1 for word in document.words if word.startMs is not None
    )
    provider_name = document.provider.name
    if provider_name not in {
        "sarvam",
        "openai",
        "gemini",
        "groq_whisper",
    }:
        raise ProcessingJobFailure(
            "transcription_provider_response_invalid",
            "The normalized transcript has an unsupported provider",
            retryable=False,
        )
    return TranscriptionJobResultV1(
        transcriptId=document.transcriptId,
        mediaAssetId=job_input.mediaAssetId,
        mediaRevision=job_input.expectedMediaRevision,
        audioVariantId=job_input.audioVariantId,
        provider=ProviderSummaryV1(
            name=provider_name,
            model=document.provider.model or "unknown",
        ),
        language=LanguageSummaryV1(
            requestedMode=document.languageMode,
            detected=(
                document.detectedLanguages[0]
                if document.detectedLanguages
                else None
            ),
        ),
        durationMs=document.durationMs,
        segmentCount=len(document.segments),
        wordCount=len(document.words),
        timedWordCount=timed_words,
        untimedWordCount=len(document.words) - timed_words,
        speakerCount=len(document.speakers) or None,
        timingSource=summarize_timing_source(document),
        warnings=sorted(set(warnings)),
        resultIdentity=transcript_result_identity(
            document.model_dump(mode="json")
        ),
        metadata={},
    )


class TranscriptionJobHandler:
    job_type = "transcription"

    def __init__(
        self,
        *,
        config: DurableTranscriptionConfig,
        storage: MediaStorage,
        repository: DurableTranscriptionRepository,
        configuration_snapshot: TranscriptionConfigSnapshot,
        storage_config: MediaStorageConfig | None = None,
        pipeline: TranscriptionPipeline | None = None,
    ) -> None:
        self.config = config
        self.storage = storage
        self.storage_config = storage_config
        self.repository = repository
        self.configuration_snapshot = configuration_snapshot
        self.pipeline = pipeline or ExistingTranscriptionPipeline()

    def _input(self, payload: dict[str, Any]) -> TranscriptionJobInputV1:
        try:
            job_input = TranscriptionJobInputV1.model_validate(payload)
            validate_request_identity(job_input)
        except (ValidationError, ValueError) as exc:
            raise JobOrchestrationError(
                "invalid_handler_input",
                "The transcription input contract is invalid",
            ) from exc
        if len(job_input.hotwords) > self.config.maximum_hotwords or any(
            len(value) > self.config.maximum_hotword_length
            for value in job_input.hotwords
        ):
            raise JobOrchestrationError(
                "invalid_handler_input",
                "The transcription hotword limits were exceeded",
            )
        return job_input

    def validate_input(self, payload: dict[str, Any]) -> None:
        self._input(payload)

    def validate_output(self, payload: dict[str, Any]) -> None:
        try:
            TranscriptionJobResultV1.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "invalid_handler_output",
                "The transcription result contract is invalid",
            ) from exc

    def _snapshot(
        self, job_input: TranscriptionJobInputV1
    ) -> dict[str, Any]:
        snapshot = self.configuration_snapshot
        if (
            job_input.providerPreference is not None
            and job_input.providerPreference != snapshot.provider
        ):
            raise ProcessingJobFailure(
                "transcription_provider_request_invalid",
                "The requested provider does not match the active routing policy",
                retryable=False,
            )
        payload = copy.deepcopy(snapshot.to_dict())
        resolved = payload.setdefault("resolved_pipeline_options", {})
        performance = resolved.setdefault("performance", {})
        existing = performance.get("providerTimeoutSeconds")
        configured = self.config.provider_timeout_seconds
        if isinstance(existing, (int, float)) and existing > 0:
            configured = min(configured, int(existing))
        performance["providerTimeoutSeconds"] = configured
        payload["source_language"] = job_input.languageMode
        payload["sourceLanguage"] = job_input.languageMode
        payload["output_language"] = "original"
        payload["outputLanguage"] = "original"
        payload["audio_origin"] = "durable_audio_variant"
        payload["audioOrigin"] = "durable_audio_variant"
        return payload

    async def execute(
        self, context: JobExecutionContext, payload: dict[str, Any]
    ) -> JobExecutionResult:
        job_input = self._input(payload)
        began = False
        try:
            await context.raise_if_cancelled()
            await context.heartbeat(progress=2, current_stage="resolving_media")
            target = await self.repository.begin(context, job_input)
            began = True
            existing = target.get("existingDocument")
            if existing is not None:
                document = TranscriptDocumentV2.model_validate(existing)
                result = _result_for_document(
                    document=document,
                    job_input=job_input,
                    warnings=list(document.quality.warnings),
                )
                output = await self.repository.finalize_success(
                    context,
                    job_input,
                    document=document.model_dump(mode="json"),
                    result=result,
                )
                return JobExecutionResult(output=output, finalized=True)

            await context.raise_if_cancelled()
            await context.heartbeat(progress=7, current_stage="resolving_audio")
            variant = target["variant"]
            try:
                storage = (
                    media_storage_for_provider(
                        variant.get("storage_provider"), self.storage_config
                    )
                    if self.storage_config
                    else self.storage
                )
                metadata = await storage.inspect_object(
                    bucket=variant["storage_bucket"],
                    path=variant["storage_path"],
                )
                if (
                    variant["size_bytes"] is not None
                    and metadata.size_bytes != variant["size_bytes"]
                ):
                    raise ProcessingJobFailure(
                        "transcription_audio_variant_stale",
                        "The transcription audio object no longer matches its row",
                        retryable=False,
                    )
                source_context = storage.open_probe_source(
                    bucket=variant["storage_bucket"],
                    path=variant["storage_path"],
                    expires_in=self.config.source_url_ttl_seconds,
                )
                async with temporary_workspace(
                    self.config.temp_root,
                    job_id=context.job_id,
                    attempt_number=context.attempt_number,
                    maximum_bytes=min(
                        self.config.maximum_source_bytes,
                        max(
                            100_000_000,
                            int(variant["size_bytes"] or 0) * 3,
                        ),
                    ),
                ) as workspace:
                    async with source_context as source:
                        audio_path = await materialize_transcription_source(
                            source,
                            context=context,
                            workspace=workspace,
                            config=self.config,
                        )
                    await context.raise_if_cancelled()
                    await context.heartbeat(
                        progress=12, current_stage="routing_provider"
                    )
                    snapshot = self._snapshot(job_input)
                    await context.heartbeat(
                        progress=15, current_stage="transcribing"
                    )
                    normalized = await self.pipeline.transcribe(
                        context=context,
                        audio_path=audio_path,
                        language_mode=job_input.languageMode,
                        configuration_snapshot=snapshot,
                        timeout_seconds=self.config.effective_timeout(
                            context.execution_timeout_seconds
                        ),
                        maximum_response_bytes=(
                            self.config.maximum_provider_response_bytes
                        ),
                        workspace=workspace,
                    )
            except StorageError as exc:
                raise _storage_failure(exc) from exc

            await context.raise_if_cancelled()
            await self.repository.mark_normalizing(context, job_input)
            await context.heartbeat(progress=86, current_stage="normalizing")
            warnings: set[str] = set()
            if job_input.hotwords:
                warnings.add("hotwords_not_supported")
            try:
                document, normalized_warnings = build_transcript_document_v2(
                    normalized,
                    transcript_id=job_input.transcriptId,
                    media_id=str(job_input.mediaAssetId),
                    duration_ms=int(target["asset"]["duration_ms"]),
                    language_mode=job_input.languageMode,
                    provider_name=self.configuration_snapshot.provider,
                    provider_model=self.configuration_snapshot.model,
                    configuration_snapshot=snapshot,
                    created_at=target["transcript"]["created_at"],
                    updated_at=datetime.now(timezone.utc),
                )
            except (ValidationError, ValueError, TypeError) as exc:
                raise ProcessingJobFailure(
                    "transcription_provider_response_invalid",
                    "The normalized transcript failed its contract",
                    retryable=False,
                ) from exc
            warnings.update(normalized_warnings)
            document.quality.warnings = sorted(warnings)
            document = TranscriptDocumentV2.model_validate(
                document.model_dump(mode="json")
            )
            await context.raise_if_cancelled()
            await context.heartbeat(
                progress=94, current_stage="validating_transcript"
            )
            result = _result_for_document(
                document=document,
                job_input=job_input,
                warnings=sorted(warnings),
            )
            await context.heartbeat(
                progress=98, current_stage="persisting_transcript"
            )
            output = await self.repository.finalize_success(
                context,
                job_input,
                document=document.model_dump(mode="json"),
                result=result,
            )
            return JobExecutionResult(output=output, finalized=True)
        except asyncio.CancelledError:
            if began:
                with suppress(JobOrchestrationError):
                    await self.repository.release_after_cancellation(
                        context, job_input
                    )
            raise
        except ProcessingJobFailure as exc:
            terminal = (
                not exc.retryable
                or context.attempt_number >= context.maximum_attempts
            )
            if terminal:
                await self.repository.finalize_permanent_failure(
                    context, job_input, exc
                )
                raise ProcessingJobFailure(
                    exc.code,
                    exc.safe_message,
                    retryable=False,
                    details={},
                    finalized=True,
                ) from exc
            raise


__all__ = ["TranscriptionJobHandler"]
