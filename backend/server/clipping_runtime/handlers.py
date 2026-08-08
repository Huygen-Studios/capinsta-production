from __future__ import annotations

import asyncio
from typing import Any

from pydantic import ValidationError

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext, JobExecutionResult
from server.clipping_orchestration.contracts import (
    ProjectConversionRequestJobInputV1,
    ProjectDerivationJobInputV1,
)

from .client import ClippingRuntimeClient
from .config import ClippingRuntimeConfig
from .errors import ClippingRuntimeError
from .identity import (
    canonical_hash,
    conversion_result_identity,
    derivation_result_identity,
)
from .repository import ClippingRuntimeRepository


def _translate(error: ClippingRuntimeError) -> BaseException:
    if error.code == "clipping_runtime_cancelled":
        return asyncio.CancelledError()
    if error.code == "clipping_runtime_lease_lost":
        return JobOrchestrationError(
            "job_lease_lost", "The runtime job lease was lost"
        )
    return ProcessingJobFailure(
        error.code, error.safe_message, retryable=error.retryable
    )


class ProjectDerivationJobHandler:
    job_type = "project_derivation"

    def __init__(
        self,
        *,
        config: ClippingRuntimeConfig,
        client: ClippingRuntimeClient,
        repository: ClippingRuntimeRepository,
    ) -> None:
        self.config = config
        self.client = client
        self.repository = repository

    @staticmethod
    def _input(payload) -> ProjectDerivationJobInputV1:
        try:
            return ProjectDerivationJobInputV1.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "project_derivation_input_invalid",
                "The project derivation job input is invalid",
            ) from exc

    def validate_input(self, payload: dict[str, Any]) -> None:
        self._input(payload)

    @staticmethod
    def validate_output(payload: dict[str, Any]) -> None:
        required = {
            "projectId",
            "projectRevision",
            "transcriptId",
            "transcriptRevision",
            "mediaRevision",
            "entryCount",
            "outputDurationMs",
            "wordCount",
            "segmentCount",
            "resultIdentity",
            "warnings",
        }
        if set(payload) != required:
            raise JobOrchestrationError(
                "invalid_handler_output", "The derivation output is invalid"
            )

    async def execute(self, context: JobExecutionContext, payload: dict[str, Any]):
        value = self._input(payload)
        try:
            await context.raise_if_cancelled()
            await context.heartbeat(progress=5, current_stage="loading_project")
            project, transcript = await self.repository.load_derivation(context, value)
            await context.raise_if_cancelled()
            await context.heartbeat(progress=25, current_stage="invoking_rust")
            result, runtime_warnings = await self.client.derive_project(
                payload={
                    "clipProject": project.model_dump(mode="json"),
                    "transcript": transcript.model_dump(mode="json"),
                    "options": {
                        "includeRemappedTranscript": value.includeRemappedTranscript
                    },
                },
                request_id=f"derive_{value.requestIdentity[:32]}",
                timeout_seconds=min(
                    self.config.derivation_timeout_seconds,
                    context.execution_timeout_seconds,
                ),
                cancellation_check=context.cancellation_callback,
                cancellation_event=context.cancellation_event,
                lease_lost_event=context.lease_lost_event,
                shutdown_event=context.shutdown_event,
            )
            await context.raise_if_cancelled()
            await context.heartbeat(progress=80, current_stage="validating_edl")
            edl = result.editDecisionList.model_dump(mode="json")
            remapped = (
                result.remappedTranscript.model_dump(mode="json")
                if result.remappedTranscript is not None
                else None
            )
            raw_result = result.model_dump(mode="json")
            identity = derivation_result_identity(
                project_id=value.clipProjectId,
                project_revision=value.expectedRevision,
                transcript_id=value.transcriptId,
                transcript_revision=value.expectedTranscriptRevision,
                media_revision=value.expectedMediaRevision,
                include_remapped_transcript=value.includeRemappedTranscript,
                result=raw_result,
            )
            warnings = sorted(
                set(
                    runtime_warnings
                    + tuple(item.category for item in result.editDecisionList.warnings)
                    + tuple(
                        item.category
                        for item in (
                            result.remappedTranscript.warnings
                            if result.remappedTranscript
                            else []
                        )
                    )
                )
            )
            output = {
                "projectId": value.clipProjectId,
                "projectRevision": value.expectedRevision,
                "transcriptId": value.transcriptId,
                "transcriptRevision": value.expectedTranscriptRevision,
                "mediaRevision": value.expectedMediaRevision,
                "entryCount": len(result.editDecisionList.entries),
                "outputDurationMs": result.editDecisionList.outputDurationMs,
                "wordCount": len(result.remappedTranscript.words)
                if result.remappedTranscript
                else 0,
                "segmentCount": len(result.remappedTranscript.segments)
                if result.remappedTranscript
                else 0,
                "resultIdentity": identity,
                "warnings": warnings,
            }
            self.validate_output(output)
            await context.heartbeat(
                progress=95, current_stage="persisting_derivation"
            )
            finalized = await self.repository.finalize_derivation(
                context,
                value,
                edl=edl,
                remapped=remapped,
                identity=identity,
                output=output,
            )
            return JobExecutionResult(output=finalized, finalized=True)
        except ClippingRuntimeError as exc:
            raise _translate(exc) from exc


class ProjectConversionJobHandler:
    job_type = "project_conversion"

    def __init__(
        self,
        *,
        config: ClippingRuntimeConfig,
        client: ClippingRuntimeClient,
        repository: ClippingRuntimeRepository,
    ) -> None:
        self.config = config
        self.client = client
        self.repository = repository

    @staticmethod
    def _input(payload) -> ProjectConversionRequestJobInputV1:
        try:
            return ProjectConversionRequestJobInputV1.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "conversion_input_invalid", "The project conversion job input is invalid"
            ) from exc

    def validate_input(self, payload: dict[str, Any]) -> None:
        self._input(payload)

    @staticmethod
    def validate_output(payload: dict[str, Any]) -> None:
        required = {
            "projectId",
            "projectRevision",
            "targetProjectId",
            "targetProjectVersion",
            "rangeCount",
            "captionCount",
            "requiresMediaAttachment",
            "resultIdentity",
            "warnings",
        }
        if set(payload) != required:
            raise JobOrchestrationError(
                "invalid_handler_output", "The conversion output is invalid"
            )

    async def execute(self, context: JobExecutionContext, payload: dict[str, Any]):
        value = self._input(payload)
        try:
            await context.raise_if_cancelled()
            await context.heartbeat(progress=5, current_stage="loading_derivation")
            conversion_input, derivation_identity = (
                await self.repository.load_conversion(context, value)
            )
            await context.raise_if_cancelled()
            await context.heartbeat(progress=30, current_stage="invoking_rust")
            result, runtime_warnings = await self.client.convert_project(
                payload=conversion_input,
                request_id=f"convert_{value.requestIdentity[:32]}",
                timeout_seconds=min(
                    self.config.conversion_timeout_seconds,
                    context.execution_timeout_seconds,
                ),
                cancellation_check=context.cancellation_callback,
                cancellation_event=context.cancellation_event,
                lease_lost_event=context.lease_lost_event,
                shutdown_event=context.shutdown_event,
            )
            await context.raise_if_cancelled()
            await context.heartbeat(progress=85, current_stage="validating_conversion")
            if (
                result.sourceClipProjectId != value.clipProjectId
                or result.sourceClipProjectRevision != value.expectedRevision
                or result.targetProjectId != value.targetProjectId
            ):
                raise ProcessingJobFailure(
                    "conversion_result_invalid",
                    "The Rust conversion result provenance is invalid",
                    retryable=False,
                )
            result_json = result.model_dump(mode="json")
            remapped = conversion_input.get("remappedTranscript")
            identity = conversion_result_identity(
                project_id=value.clipProjectId,
                project_revision=value.expectedRevision,
                edl_identity=derivation_identity,
                remapped_identity=canonical_hash(remapped) if remapped else None,
                target_project_id=value.targetProjectId,
                include_captions=value.includeCaptions,
                result=result_json,
            )
            mapping = result.mapping
            output = {
                "projectId": value.clipProjectId,
                "projectRevision": value.expectedRevision,
                "targetProjectId": result.targetProjectId,
                "targetProjectVersion": result.project["version"],
                "rangeCount": len(mapping.get("rangeMappings", [])),
                "captionCount": len(mapping.get("captionMappings", [])),
                "requiresMediaAttachment": result.mediaReference[
                    "requiresMediaAttachment"
                ],
                "resultIdentity": identity,
                "warnings": sorted(
                    set(runtime_warnings)
                    | {item.get("category", "unknown") for item in result.warnings}
                ),
            }
            self.validate_output(output)
            await context.heartbeat(
                progress=95, current_stage="persisting_conversion"
            )
            finalized = await self.repository.finalize_conversion(
                context,
                value,
                result=result_json,
                identity=identity,
                output=output,
            )
            return JobExecutionResult(output=finalized, finalized=True)
        except ClippingRuntimeError as exc:
            raise _translate(exc) from exc
