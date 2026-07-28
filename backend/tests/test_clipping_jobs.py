import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from server.clipping_jobs.config import ProcessingWorkerConfig
from server.clipping_jobs.errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from server.clipping_jobs.models import (
    JobClaim,
    JobExecutionResult,
)
from server.clipping_jobs.policies import RetryBackoff
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_jobs.worker import ProcessingWorker


class DummyHandler:
    def __init__(
        self,
        job_type="media_probe",
        *,
        failure=None,
        heartbeat=False,
        blocker=None,
        output=None,
    ):
        self.job_type = job_type
        self.failure = failure
        self.send_heartbeat = heartbeat
        self.blocker = blocker
        self.output = output or {"ok": True}

    def validate_input(self, payload):
        if payload.get("invalid"):
            raise ValueError("invalid")

    def validate_output(self, payload):
        if "invalid" in payload:
            raise ValueError("invalid")

    async def execute(self, context, payload):
        if self.send_heartbeat:
            await context.heartbeat(progress=50, current_stage="test")
        if self.blocker is not None:
            await self.blocker.wait()
        if self.failure:
            raise self.failure
        return JobExecutionResult(output=self.output)


class FakeRepository:
    def __init__(self, claims=None):
        self.claims = list(claims or [])
        self.claim_calls = 0
        self.started = []
        self.heartbeats = []
        self.completed = []
        self.failures = []
        self.acknowledged = []
        self.cancel_requested = False
        self.claim_failures = 0
        self.heartbeat_error = None

    async def claim_next_job(self, **kwargs):
        self.claim_calls += 1
        if self.claim_failures:
            self.claim_failures -= 1
            raise JobOrchestrationError(
                "database_temporarily_unavailable", "temporary"
            )
        return self.claims.pop(0) if self.claims else None

    async def start_running(self, job_id, **kwargs):
        self.started.append(job_id)
        return {"status": "running"}

    async def heartbeat_job(self, job_id, **kwargs):
        if self.heartbeat_error:
            raise self.heartbeat_error
        self.heartbeats.append(kwargs)
        return {
            "status": (
                "cancel_requested" if self.cancel_requested else "running"
            )
        }

    async def cancellation_requested(self, job_id, **kwargs):
        return self.cancel_requested

    async def complete_job_success(self, job_id, **kwargs):
        self.completed.append((job_id, kwargs["output"]))
        return {"status": "succeeded"}

    async def record_failure(self, job_id, **kwargs):
        self.failures.append((job_id, kwargs["failure"]))
        return {
            "status": (
                "retry_wait" if kwargs["failure"].retryable else "failed"
            )
        }

    async def acknowledge_cancellation(self, job_id, **kwargs):
        self.acknowledged.append(job_id)
        return {"status": "cancelled"}


def _claim():
    return JobClaim(
        job_id=uuid4(),
        job_type="media_probe",
        input={
            "schemaVersion": 1,
            "jobType": "media_probe",
            "metadata": {},
        },
        attempt_number=1,
        worker_id="worker-test",
        claim_token=uuid4(),
        lease_expires_at=datetime.now(timezone.utc) + timedelta(seconds=90),
        revision=2,
        execution_timeout_seconds=5,
    )


def _config(*, enabled=True, poll=0.05, grace=1, concurrency=1):
    return ProcessingWorkerConfig(
        enabled=enabled,
        worker_id="worker-test",
        poll_seconds=poll,
        maximum_concurrency=concurrency,
        shutdown_grace_seconds=grace,
        lease_seconds=5,
        heartbeat_seconds=1,
        retry_jitter_percent=0,
        recovery_interval_seconds=30,
    )


def test_configuration_and_retry_backoff(monkeypatch):
    monkeypatch.setenv("PROCESSING_JOB_LEASE_SECONDS", "30")
    monkeypatch.setenv("PROCESSING_JOB_HEARTBEAT_SECONDS", "30")
    with pytest.raises(JobOrchestrationError) as error:
        ProcessingWorkerConfig.from_env()
    assert error.value.category == "worker_not_configured"
    backoff = RetryBackoff(
        base_seconds=10,
        multiplier=2,
        maximum_seconds=25,
        jitter_percent=0,
    )
    assert [backoff.delay_seconds(i) for i in (1, 2, 3, 4)] == [
        10,
        20,
        25,
        25,
    ]
    jittered = RetryBackoff(
        base_seconds=100,
        multiplier=2,
        maximum_seconds=1000,
        jitter_percent=20,
    )
    assert jittered.delay_seconds(1, random_value=lambda: 0) == 80
    assert jittered.delay_seconds(1, random_value=lambda: 1) == 120


def test_handler_registry_registration_and_duplicates():
    registry = JobHandlerRegistry()
    handler = DummyHandler()
    registry.register(handler)
    assert registry.get("media_probe") is handler
    assert registry.supported_job_types == ("media_probe",)
    with pytest.raises(JobOrchestrationError):
        registry.register(DummyHandler())
    with pytest.raises(JobOrchestrationError):
        registry.get("transcription")


def test_worker_success_heartbeat_failure_and_disabled():
    async def scenario():
        registry = JobHandlerRegistry()
        registry.register(DummyHandler(heartbeat=True))
        success_claim = _claim()
        repository = FakeRepository([success_claim])
        worker = ProcessingWorker(
            config=_config(),
            repository=repository,
            registry=registry,
        )
        task = asyncio.create_task(worker.run_forever())
        for _ in range(100):
            if repository.completed:
                break
            await asyncio.sleep(0.01)
        worker.request_shutdown()
        await task
        assert repository.started == [success_claim.job_id]
        assert repository.heartbeats[0]["progress"] == 50
        assert repository.completed == [(success_claim.job_id, {"ok": True})]

        failure_registry = JobHandlerRegistry()
        failure_registry.register(
            DummyHandler(
                failure=ProcessingJobFailure(
                    "controlled_failure",
                    "Controlled failure",
                    retryable=True,
                )
            )
        )
        failure_claim = _claim()
        failure_repository = FakeRepository([failure_claim])
        failure_worker = ProcessingWorker(
            config=_config(),
            repository=failure_repository,
            registry=failure_registry,
        )
        failure_task = asyncio.create_task(failure_worker.run_forever())
        for _ in range(100):
            if failure_repository.failures:
                break
            await asyncio.sleep(0.01)
        failure_worker.request_shutdown()
        await failure_task
        assert failure_repository.failures[0][1].code == "controlled_failure"

        disabled_repository = FakeRepository([_claim()])
        disabled = ProcessingWorker(
            config=_config(enabled=False),
            repository=disabled_repository,
            registry=registry,
        )
        await disabled.run_forever()
        assert disabled_repository.claim_calls == 0

    asyncio.run(scenario())


def test_worker_shutdown_stops_claiming_and_waits_for_handler():
    async def scenario():
        blocker = asyncio.Event()
        registry = JobHandlerRegistry()
        registry.register(DummyHandler(blocker=blocker))
        repository = FakeRepository([_claim(), _claim()])
        worker = ProcessingWorker(
            config=_config(grace=2),
            repository=repository,
            registry=registry,
        )
        task = asyncio.create_task(worker.run_forever())
        for _ in range(100):
            if repository.started:
                break
            await asyncio.sleep(0.01)
        worker.request_shutdown()
        await asyncio.sleep(0.02)
        assert len(repository.started) == 1
        blocker.set()
        await task
        assert len(repository.completed) == 1
        assert len(repository.claims) == 1

    asyncio.run(scenario())


def test_worker_claims_only_available_concurrency_slots():
    async def scenario():
        blocker = asyncio.Event()
        registry = JobHandlerRegistry()
        registry.register(DummyHandler(blocker=blocker))
        repository = FakeRepository([_claim(), _claim(), _claim()])
        worker = ProcessingWorker(
            config=_config(concurrency=2),
            repository=repository,
            registry=registry,
        )
        task = asyncio.create_task(worker.run_forever())
        for _ in range(100):
            if len(repository.started) == 2:
                break
            await asyncio.sleep(0.01)
        assert len(repository.started) == 2
        assert len(repository.claims) == 1
        worker.request_shutdown()
        blocker.set()
        await task

    asyncio.run(scenario())


def test_worker_normalizes_validation_errors_retries_database_and_loses_lease():
    async def run_worker(repository, handler, *, wait_for):
        registry = JobHandlerRegistry()
        registry.register(handler)
        worker = ProcessingWorker(
            config=_config(),
            repository=repository,
            registry=registry,
        )
        task = asyncio.create_task(worker.run_forever())
        for _ in range(200):
            if wait_for(repository):
                break
            await asyncio.sleep(0.01)
        worker.request_shutdown()
        await task

    async def scenario():
        invalid_claim = replace(
            _claim(),
            input={
                "schemaVersion": 1,
                "jobType": "media_probe",
                "metadata": {},
                "invalid": True,
            },
        )
        invalid_repository = FakeRepository([invalid_claim])
        await run_worker(
            invalid_repository,
            DummyHandler(),
            wait_for=lambda repo: bool(repo.failures),
        )
        assert invalid_repository.failures[0][1].code == "invalid_handler_input"

        output_repository = FakeRepository([_claim()])
        await run_worker(
            output_repository,
            DummyHandler(output={"invalid": True}),
            wait_for=lambda repo: bool(repo.failures),
        )
        assert output_repository.failures[0][1].code == "invalid_handler_output"

        transient_repository = FakeRepository([_claim()])
        transient_repository.claim_failures = 1
        await run_worker(
            transient_repository,
            DummyHandler(),
            wait_for=lambda repo: bool(repo.completed),
        )
        assert transient_repository.claim_calls >= 2
        assert transient_repository.completed

        lost_repository = FakeRepository([_claim()])
        lost_repository.heartbeat_error = JobOrchestrationError(
            "job_lease_lost", "lost"
        )
        await run_worker(
            lost_repository,
            DummyHandler(heartbeat=True),
            wait_for=lambda repo: repo.claim_calls > 1,
        )
        assert not lost_repository.completed
        assert not lost_repository.failures

    asyncio.run(scenario())
