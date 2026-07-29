from __future__ import annotations

import asyncio
from contextlib import suppress
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

from .config import MediaProbeConfig
from .contracts import MediaProbeJobInputV1, MediaProbeResultV1
from .ffprobe import FFprobeRunner, MediaProbeCancelled
from .normalization import MediaProbeNormalizer, parse_ffprobe_json
from .repository import MediaProbeRepository


def _storage_failure(error: StorageError) -> ProcessingJobFailure:
    mapping = {
        "object_not_found": (
            "probe_source_unavailable",
            "The verified media object is temporarily unavailable",
            True,
        ),
        "storage_provider_unavailable": (
            "storage_provider_unavailable",
            "Media storage is temporarily unavailable",
            True,
        ),
        "signed_url_failed": (
            "probe_source_unavailable",
            "A private media probe source could not be authorized",
            True,
        ),
        "storage_permission_denied": (
            "probe_source_unavailable",
            "The media worker could not authorize the stored object",
            False,
        ),
    }
    code, message, retryable = mapping.get(
        error.category,
        ("probe_source_unavailable", "The media source is unavailable", True),
    )
    return ProcessingJobFailure(code, message, retryable=retryable)


class MediaProbeJobHandler:
    job_type = "media_probe"

    def __init__(
        self,
        *,
        config: MediaProbeConfig,
        storage: MediaStorage,
        repository: MediaProbeRepository,
        storage_config: MediaStorageConfig | None = None,
        runner: FFprobeRunner | None = None,
        normalizer: MediaProbeNormalizer | None = None,
    ) -> None:
        self.config = config
        self.storage = storage
        self.storage_config = storage_config
        self.repository = repository
        self.runner = runner or FFprobeRunner(config)
        self.normalizer = normalizer or MediaProbeNormalizer(
            maximum_duration_ms=config.maximum_duration_ms,
            maximum_fps=config.maximum_fps,
        )

    @staticmethod
    def _input(payload: dict[str, Any]) -> MediaProbeJobInputV1:
        try:
            return MediaProbeJobInputV1.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "invalid_handler_input",
                "The media_probe input contract is invalid",
            ) from exc

    def validate_input(self, payload: dict[str, Any]) -> None:
        self._input(payload)

    def validate_output(self, payload: dict[str, Any]) -> None:
        try:
            MediaProbeResultV1.model_validate(payload)
        except ValidationError as exc:
            raise JobOrchestrationError(
                "invalid_handler_output",
                "The media_probe result contract is invalid",
            ) from exc

    async def execute(
        self, context: JobExecutionContext, payload: dict[str, Any]
    ) -> JobExecutionResult:
        job_input = self._input(payload)
        probe_started = False
        try:
            await context.raise_if_cancelled()
            await context.heartbeat(
                progress=5, current_stage="resolving_asset"
            )
            asset = await self.repository.begin_probe(context, job_input)
            probe_started = True
            await context.raise_if_cancelled()
            await context.heartbeat(
                progress=10, current_stage="authorizing_storage"
            )
            try:
                storage = (
                    media_storage_for_provider(
                        asset.get("storage_provider"), self.storage_config
                    )
                    if self.storage_config
                    else self.storage
                )
                object_metadata = await storage.inspect_object(
                    bucket=asset["storage_bucket"],
                    path=asset["storage_path"],
                )
            except StorageError as exc:
                raise _storage_failure(exc) from exc
            await context.raise_if_cancelled()
            try:
                source_context = storage.open_probe_source(
                    bucket=asset["storage_bucket"],
                    path=asset["storage_path"],
                    expires_in=self.config.signed_url_ttl_seconds,
                )
                async with source_context as source:
                    await context.heartbeat(
                        progress=20, current_stage="probing"
                    )
                    raw_output = await self.runner.run(
                        source,
                        job_timeout_seconds=context.execution_timeout_seconds,
                        cancellation_check=context.cancellation_callback,
                        cancellation_event=context.cancellation_event,
                        lease_lost_event=context.lease_lost_event,
                        stop_event=context.shutdown_event,
                    )
            except StorageError as exc:
                raise _storage_failure(exc) from exc
            await context.heartbeat(
                progress=75, current_stage="normalizing"
            )
            parsed = parse_ffprobe_json(
                raw_output,
                maximum_bytes=self.config.maximum_stdout_bytes,
            )
            result = self.normalizer.normalize(
                parsed,
                job_input=job_input,
                declared_mime=asset["mime_type"],
                storage_mime=object_metadata.mime_type,
                display_name=asset["display_name"],
            )
            if await context.cancellation_callback():
                raise MediaProbeCancelled
            await context.heartbeat(
                progress=90, current_stage="persisting_metadata"
            )
            output = await self.repository.finalize_success(
                context, job_input, result
            )
            return JobExecutionResult(output=output, finalized=True)
        except MediaProbeCancelled:
            if probe_started:
                await self.repository.release_after_cancellation(
                    context, job_input
                )
            raise asyncio.CancelledError
        except asyncio.CancelledError:
            if probe_started and context.cancellation_event.is_set():
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
            if probe_started and terminal:
                await self.repository.finalize_permanent_failure(
                    context, job_input, exc
                )
                raise ProcessingJobFailure(
                    exc.code,
                    exc.safe_message,
                    retryable=False,
                    details=exc.details,
                    finalized=True,
                ) from exc
            raise


__all__ = ["MediaProbeJobHandler"]
