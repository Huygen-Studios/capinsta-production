from __future__ import annotations

import asyncio
import logging
import os
import signal
import time
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import Any

from server.clipping_persistence.database import DurableDatabase

from .config import ProcessingWorkerConfig
from .errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from .models import (
    JobClaim,
    JobExecutionContext,
    JobExecutionResult,
    JobFailure,
)
from .policies import DEFAULT_JOB_POLICIES, RetryBackoff
from .registry import JobHandlerRegistry
from .repository import (
    ProcessingJobLeaseRepository,
    ProcessingJobRecoveryService,
)

logger = logging.getLogger(__name__)


class WorkerEventLogger:
    def emit(self, event: str, **fields: Any) -> None:
        safe_fields = " ".join(
            f"{key}={value}"
            for key, value in fields.items()
            if value is not None and key != "claim_token"
        )
        logger.info("processing_worker_event event=%s %s", event, safe_fields)


class ProcessingWorker:
    def __init__(
        self,
        *,
        config: ProcessingWorkerConfig,
        repository: ProcessingJobLeaseRepository,
        registry: JobHandlerRegistry,
        recovery: ProcessingJobRecoveryService | None = None,
        events: WorkerEventLogger | None = None,
    ) -> None:
        config.validate()
        self.config = config
        self.repository = repository
        self.registry = registry
        self.recovery = recovery
        self.events = events or WorkerEventLogger()
        self._stopping = asyncio.Event()
        self._active: set[asyncio.Task[None]] = set()
        self._handler_stop_events: set[asyncio.Event] = set()
        self.last_successful_poll_at: float | None = None

    @property
    def active_job_count(self) -> int:
        return sum(1 for task in self._active if not task.done())

    def request_shutdown(self) -> None:
        self._stopping.set()
        for event in tuple(self._handler_stop_events):
            event.set()

    async def _sleep_or_stop(self, seconds: float) -> None:
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=seconds)
        except TimeoutError:
            pass

    def _retry_backoff(self) -> RetryBackoff:
        return RetryBackoff(
            base_seconds=self.config.retry_base_seconds,
            multiplier=self.config.retry_multiplier,
            maximum_seconds=self.config.retry_max_seconds,
            jitter_percent=self.config.retry_jitter_percent,
        )

    async def _record_failure(
        self,
        claim: JobClaim,
        failure: JobFailure,
    ) -> None:
        retry_at = None
        if failure.retryable:
            retry_at = datetime.now(timezone.utc) + timedelta(
                seconds=self._retry_backoff().delay_seconds(
                    claim.attempt_number
                )
            )
        try:
            result = await self.repository.record_failure(
                claim.job_id,
                worker_id=claim.worker_id,
                claim_token=claim.claim_token,
                failure=failure,
                retry_at=retry_at,
            )
            self.events.emit(
                "jobs_retried" if result["status"] == "retry_wait" else "jobs_failed",
                job_id=claim.job_id,
                job_type=claim.job_type,
                attempt_number=claim.attempt_number,
                worker_id=claim.worker_id,
                status=result["status"],
                error_code=failure.code,
            )
        except JobOrchestrationError as exc:
            self.events.emit(
                "failure_commit_rejected",
                job_id=claim.job_id,
                job_type=claim.job_type,
                attempt_number=claim.attempt_number,
                worker_id=claim.worker_id,
                error_code=exc.category,
            )

    async def _execute_claim(self, claim: JobClaim) -> None:
        started_monotonic = time.monotonic()
        handler_stop = asyncio.Event()
        job_cancel_requested = asyncio.Event()
        lease_lost = asyncio.Event()
        self._handler_stop_events.add(handler_stop)
        heartbeat_task: asyncio.Task[None] | None = None
        handler_task: asyncio.Task[JobExecutionResult] | None = None
        try:
            try:
                handler = self.registry.get(claim.job_type)
                handler.validate_input(claim.input)
            except JobOrchestrationError:
                raise
            except Exception as exc:
                raise JobOrchestrationError(
                    "invalid_handler_input",
                    "Job handler rejected its input",
                ) from exc

            running = await self.repository.start_running(
                claim.job_id,
                worker_id=claim.worker_id,
                claim_token=claim.claim_token,
                lease_seconds=self.config.lease_seconds,
                current_stage="running",
                expected_revision=claim.revision,
            )

            async def heartbeat_callback(
                *,
                progress: float | None = None,
                current_stage: str | None = None,
            ) -> dict[str, Any]:
                row = await self.repository.heartbeat_job(
                    claim.job_id,
                    worker_id=claim.worker_id,
                    claim_token=claim.claim_token,
                    lease_extension_seconds=self.config.lease_seconds,
                    progress=progress,
                    current_stage=current_stage,
                )
                if row["status"] == "cancel_requested":
                    job_cancel_requested.set()
                    handler_stop.set()
                return row

            async def cancellation_callback() -> bool:
                cancelled = await self.repository.cancellation_requested(
                    claim.job_id,
                    worker_id=claim.worker_id,
                    claim_token=claim.claim_token,
                )
                if cancelled:
                    job_cancel_requested.set()
                    handler_stop.set()
                return cancelled

            context = JobExecutionContext(
                job_id=claim.job_id,
                attempt_number=claim.attempt_number,
                worker_id=claim.worker_id,
                claim_token=claim.claim_token,
                heartbeat_callback=heartbeat_callback,
                cancellation_callback=cancellation_callback,
                shutdown_event=handler_stop,
                cancellation_event=job_cancel_requested,
                lease_lost_event=lease_lost,
                maximum_attempts=claim.maximum_attempts,
                execution_timeout_seconds=(
                    claim.execution_timeout_seconds
                    or DEFAULT_JOB_POLICIES[claim.job_type].default_timeout_seconds
                ),
            )

            async def heartbeat_loop() -> None:
                while not handler_stop.is_set():
                    await self._sleep_for_handler(
                        handler_stop, self.config.heartbeat_seconds
                    )
                    if handler_stop.is_set():
                        return
                    try:
                        await heartbeat_callback()
                    except JobOrchestrationError as exc:
                        lease_lost.set()
                        handler_stop.set()
                        if handler_task is not None:
                            handler_task.cancel()
                        self.events.emit(
                            "heartbeat_failures",
                            job_id=claim.job_id,
                            job_type=claim.job_type,
                            attempt_number=claim.attempt_number,
                            worker_id=claim.worker_id,
                            error_code=exc.category,
                        )
                        return

            heartbeat_task = asyncio.create_task(
                heartbeat_loop(), name=f"job-heartbeat-{claim.job_id}"
            )
            handler_task = asyncio.create_task(
                handler.execute(context, claim.input),
                name=f"job-handler-{claim.job_id}",
            )
            policy = DEFAULT_JOB_POLICIES[claim.job_type]
            timeout_seconds = (
                claim.execution_timeout_seconds
                or policy.default_timeout_seconds
            )
            try:
                result = await asyncio.wait_for(
                    handler_task, timeout=timeout_seconds
                )
            except TimeoutError:
                await self._record_failure(
                    claim,
                    JobFailure(
                        code="processor_timeout",
                        message="Processing exceeded its execution timeout",
                        retryable=True,
                    ),
                )
                return
            except asyncio.CancelledError:
                if lease_lost.is_set():
                    return
                if job_cancel_requested.is_set():
                    with suppress(JobOrchestrationError):
                        await self.repository.acknowledge_cancellation(
                            claim.job_id,
                            worker_id=claim.worker_id,
                            claim_token=claim.claim_token,
                        )
                    self.events.emit(
                        "jobs_cancelled",
                        job_id=claim.job_id,
                        job_type=claim.job_type,
                        attempt_number=claim.attempt_number,
                        worker_id=claim.worker_id,
                    )
                    return
                raise
            except JobOrchestrationError as exc:
                if exc.category in {
                    "job_lease_lost",
                    "job_lease_expired",
                    "worker_mismatch",
                    "claim_token_mismatch",
                }:
                    # Cancellation can race a handler's first authoritative
                    # row lock: the row is already cancel_requested, while the
                    # handler correctly accepts only claimed/running targets.
                    # Acknowledge that owned cancellation instead of waiting
                    # for lease recovery.
                    if exc.category == "job_lease_lost":
                        with suppress(JobOrchestrationError):
                            if await cancellation_callback():
                                await self.repository.acknowledge_cancellation(
                                    claim.job_id,
                                    worker_id=claim.worker_id,
                                    claim_token=claim.claim_token,
                                )
                                self.events.emit(
                                    "jobs_cancelled",
                                    job_id=claim.job_id,
                                    job_type=claim.job_type,
                                    attempt_number=claim.attempt_number,
                                    worker_id=claim.worker_id,
                                )
                    return
                await self._record_failure(
                    claim,
                    JobFailure(
                        code=exc.category,
                        message=exc.message,
                        retryable=(
                            exc.category
                            in DEFAULT_JOB_POLICIES[
                                claim.job_type
                            ].retryable_error_codes
                        ),
                    ),
                )
                return
            except ProcessingJobFailure as exc:
                if exc.finalized:
                    self.events.emit(
                        "jobs_failed",
                        job_id=claim.job_id,
                        job_type=claim.job_type,
                        attempt_number=claim.attempt_number,
                        worker_id=claim.worker_id,
                        status="failed",
                        error_code=exc.code,
                    )
                    return
                await self._record_failure(
                    claim,
                    JobFailure(
                        code=exc.code,
                        message=exc.safe_message,
                        retryable=exc.retryable,
                        details=exc.details,
                    ),
                )
                return
            except Exception as exc:
                logger.error(
                    "processing_handler_exception job_id=%s job_type=%s "
                    "attempt_number=%s worker_id=%s exception_type=%s",
                    claim.job_id,
                    claim.job_type,
                    claim.attempt_number,
                    claim.worker_id,
                    type(exc).__name__,
                )
                await self._record_failure(
                    claim,
                    JobFailure(
                        code="handler_exception",
                        message="The processing handler failed",
                        retryable=False,
                    ),
                )
                return

            if not result.finalized and await cancellation_callback():
                await self.repository.acknowledge_cancellation(
                    claim.job_id,
                    worker_id=claim.worker_id,
                    claim_token=claim.claim_token,
                )
                return
            if not isinstance(result, JobExecutionResult):
                raise JobOrchestrationError(
                    "invalid_handler_output",
                    "Handler returned an invalid result envelope",
                )
            try:
                handler.validate_output(result.output)
            except Exception as exc:
                raise JobOrchestrationError(
                    "invalid_handler_output",
                    "Job handler rejected its output",
                ) from exc
            completed = await self.repository.complete_job_success(
                claim.job_id,
                worker_id=claim.worker_id,
                claim_token=claim.claim_token,
                output=result.output,
            )
            self.events.emit(
                "jobs_succeeded",
                job_id=claim.job_id,
                job_type=claim.job_type,
                attempt_number=claim.attempt_number,
                worker_id=claim.worker_id,
                status=completed["status"],
                duration_ms=round(
                    (time.monotonic() - started_monotonic) * 1000
                ),
            )
        except JobOrchestrationError as exc:
            if exc.category not in {
                "job_lease_lost",
                "job_lease_expired",
                "worker_mismatch",
                "claim_token_mismatch",
            }:
                await self._record_failure(
                    claim,
                    JobFailure(
                        code=exc.category,
                        message=exc.message,
                        retryable=(
                            exc.category
                            in DEFAULT_JOB_POLICIES[
                                claim.job_type
                            ].retryable_error_codes
                        ),
                    ),
                )
        finally:
            handler_stop.set()
            self._handler_stop_events.discard(handler_stop)
            if heartbeat_task is not None:
                heartbeat_task.cancel()
                with suppress(asyncio.CancelledError):
                    await heartbeat_task

    @staticmethod
    async def _sleep_for_handler(
        stop_event: asyncio.Event, seconds: float
    ) -> None:
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=seconds)
        except TimeoutError:
            pass

    async def run_forever(self) -> None:
        if not self.config.enabled:
            self.events.emit("worker_disabled", worker_id=self.config.worker_id)
            return
        if self.config.required_job_types:
            missing = [
                j for j in self.config.required_job_types
                if j not in self.registry.supported_job_types
            ]
            if missing:
                raise JobOrchestrationError(
                    "required_handler_missing",
                    f"Worker is missing required handlers: {','.join(missing)}"
                )
        next_recovery = 0.0
        transient_failures = 0
        self.events.emit(
            "worker_started",
            worker_id=self.config.worker_id,
            status="ready",
            supported_job_types=",".join(self.registry.supported_job_types),
            required_job_types=",".join(self.config.required_job_types),
        )
        worker_role = self.config.worker_id.split("-")[-1] if "-" in self.config.worker_id else "worker"
        build_sha = os.getenv("BUILD_SHA", os.getenv("CAPINSTA_IMAGE_TAG", "unknown"))
        while not self._stopping.is_set():
            self._active = {task for task in self._active if not task.done()}
            now = time.monotonic()
            if hasattr(self.repository, "upsert_worker_heartbeat"):
                await self.repository.upsert_worker_heartbeat(
                    worker_id=self.config.worker_id,
                    role=worker_role,
                    supported_job_types=self.registry.supported_job_types,
                    build_sha=build_sha,
                    active_job_count=self.active_job_count,
                    status="active",
                )
            if self.recovery is not None and now >= next_recovery:
                try:
                    result = await self.recovery.run_once()
                    if result["lockAcquired"]:
                        self.events.emit(
                            "recovery_sweep",
                            worker_id=self.config.worker_id,
                            leases_expired=result["leasesRecovered"],
                            retries_promoted=result["retriesPromoted"],
                        )
                    next_recovery = (
                        now + self.config.recovery_interval_seconds
                    )
                except JobOrchestrationError as exc:
                    self.events.emit(
                        "recovery_failed",
                        worker_id=self.config.worker_id,
                        error_code=exc.category,
                    )

            claimed_any = False
            while (
                not self._stopping.is_set()
                and len(self._active) < self.config.maximum_concurrency
            ):
                try:
                    claim = await self.repository.claim_next_job(
                        worker_id=self.config.worker_id,
                        supported_job_types=self.registry.supported_job_types,
                        lease_seconds=self.config.lease_seconds,
                    )
                    self.last_successful_poll_at = time.time()
                    transient_failures = 0
                except JobOrchestrationError as exc:
                    transient_failures += 1
                    self.events.emit(
                        "claim_failed",
                        worker_id=self.config.worker_id,
                        error_code=exc.category,
                    )
                    await self._sleep_or_stop(
                        min(
                            self.config.poll_seconds
                            * (2 ** min(transient_failures, 5)),
                            30,
                        )
                    )
                    break
                if claim is None:
                    break
                claimed_any = True
                if hasattr(self.repository, "upsert_worker_heartbeat"):
                    await self.repository.upsert_worker_heartbeat(
                        worker_id=self.config.worker_id,
                        role=worker_role,
                        supported_job_types=self.registry.supported_job_types,
                        build_sha=build_sha,
                        active_job_count=self.active_job_count,
                        status="active",
                        claimed_job=True,
                    )
                self.events.emit(
                    "jobs_claimed",
                    job_id=claim.job_id,
                    job_type=claim.job_type,
                    attempt_number=claim.attempt_number,
                    worker_id=claim.worker_id,
                )
                task = asyncio.create_task(
                    self._execute_claim(claim),
                    name=f"processing-job-{claim.job_id}",
                )
                self._active.add(task)
                task.add_done_callback(self._active.discard)
            if not claimed_any:
                await self._sleep_or_stop(self.config.poll_seconds)

        for event in tuple(self._handler_stop_events):
            event.set()
        if self._active:
            _, pending = await asyncio.wait(
                self._active,
                timeout=self.config.shutdown_grace_seconds,
            )
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        if hasattr(self.repository, "upsert_worker_heartbeat"):
            await self.repository.upsert_worker_heartbeat(
                worker_id=self.config.worker_id,
                role=worker_role,
                supported_job_types=self.registry.supported_job_types,
                build_sha=build_sha,
                active_job_count=0,
                status="stopped",
            )
        self.events.emit(
            "worker_stopped",
            worker_id=self.config.worker_id,
            active_jobs=0,
        )


def _database_url() -> str:
    return (
        os.getenv("ADMIN_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or ""
    ).strip()


async def main_async() -> int:
    config = ProcessingWorkerConfig.from_env()
    if not config.enabled:
        logger.info("Durable processing worker is disabled")
        return 0
    database_url = _database_url()
    if not database_url:
        logger.error("Durable processing worker database is not configured")
        return 2
    database = DurableDatabase(database_url)
    repository = ProcessingJobLeaseRepository(database)
    registry = JobHandlerRegistry()
    from server.media_probe.registration import (
        register_media_probe_if_enabled,
    )

    ffprobe_version = await register_media_probe_if_enabled(
        registry, database
    )
    if ffprobe_version is not None:
        logger.info(
            "processing_worker_handler_registered job_type=media_probe "
            "ffprobe_version=%s",
            ffprobe_version,
        )
    from server.media_variants.registration import (
        register_media_variants_if_enabled,
    )

    variant_versions = await register_media_variants_if_enabled(
        registry, database
    )
    if variant_versions is not None:
        logger.info(
            "processing_worker_variant_handlers_registered job_types=%s "
            "ffmpeg_version=%s ffprobe_version=%s",
            ",".join(
                job_type
                for job_type in registry.supported_job_types
                if job_type
                in {
                    "proxy_generation",
                    "audio_extraction",
                    "thumbnail_generation",
                    "waveform_generation",
                }
            ),
            variant_versions[0],
            variant_versions[1],
        )
    from server.durable_transcription.registration import (
        register_durable_transcription_if_enabled,
    )

    transcription_provider = (
        await register_durable_transcription_if_enabled(registry, database)
    )
    if transcription_provider is not None:
        logger.info(
            "processing_worker_handler_registered job_type=transcription "
            "provider=%s model=%s",
            transcription_provider[0],
            transcription_provider[1],
        )
    from server.transcript_analysis.registration import (
        register_transcript_analysis_if_enabled,
    )

    analysis_handlers = await register_transcript_analysis_if_enabled(
        registry, database
    )
    if analysis_handlers is not None:
        logger.info(
            "processing_worker_analysis_handlers_registered handlers=%s",
            ",".join(analysis_handlers),
        )
    from server.automatic_clipper.registration import (
        register_automatic_clipper_if_enabled,
    )

    automatic_handlers = await register_automatic_clipper_if_enabled(
        registry, database
    )
    if automatic_handlers is not None:
        logger.info(
            "processing_worker_automatic_clipper_registered handlers=%s",
            ",".join(automatic_handlers),
        )
    from server.clipping_runtime.registration import (
        register_clipping_runtime_if_enabled,
    )

    runtime_handlers = await register_clipping_runtime_if_enabled(
        registry, database
    )
    if runtime_handlers is not None:
        logger.info(
            "processing_worker_clipping_runtime_registered runtime_version=%s handlers=%s",
            runtime_handlers[0],
            ",".join(runtime_handlers[1]),
        )
    from server.clipping_exports.registration import (
        register_clipping_exports_if_enabled,
    )

    export_preset = await register_clipping_exports_if_enabled(
        registry, database
    )
    if export_preset is not None:
        logger.info(
            "processing_worker_clipping_export_registered preset=%s",
            export_preset,
        )
    recovery = ProcessingJobRecoveryService(
        repository,
        backoff=RetryBackoff(
            base_seconds=config.retry_base_seconds,
            multiplier=config.retry_multiplier,
            maximum_seconds=config.retry_max_seconds,
            jitter_percent=config.retry_jitter_percent,
        ),
        batch_size=config.recovery_batch_size,
    )
    worker = ProcessingWorker(
        config=config,
        repository=repository,
        registry=registry,
        recovery=recovery,
    )
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(signum, worker.request_shutdown)
    await worker.run_forever()
    return 0


def main() -> int:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    try:
        return asyncio.run(main_async())
    except JobOrchestrationError as exc:
        logger.error("processing_worker_startup_failed code=%s", exc.category)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
