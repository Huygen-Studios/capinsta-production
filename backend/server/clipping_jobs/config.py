from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from uuid import uuid4

from .errors import JobOrchestrationError


def _enabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise JobOrchestrationError(
            "worker_not_configured", f"{name} must be an integer"
        ) from exc
    if not minimum <= value <= maximum:
        raise JobOrchestrationError(
            "worker_not_configured",
            f"{name} must be between {minimum} and {maximum}",
        )
    return value


def _float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError as exc:
        raise JobOrchestrationError(
            "worker_not_configured", f"{name} must be numeric"
        ) from exc
    if not minimum <= value <= maximum:
        raise JobOrchestrationError(
            "worker_not_configured",
            f"{name} must be between {minimum} and {maximum}",
        )
    return value


@dataclass(frozen=True)
class ProcessingWorkerConfig:
    enabled: bool = False
    worker_id: str = ""
    required_job_types: tuple[str, ...] = ()
    poll_seconds: float = 2.0
    maximum_concurrency: int = 1
    shutdown_grace_seconds: int = 30
    lease_seconds: int = 90
    heartbeat_seconds: int = 30
    retry_base_seconds: int = 10
    retry_multiplier: float = 2.0
    retry_max_seconds: int = 900
    retry_jitter_percent: int = 20
    recovery_interval_seconds: int = 30
    recovery_batch_size: int = 100

    @classmethod
    def from_env(cls) -> "ProcessingWorkerConfig":
        configured_id = (os.getenv("PROCESSING_WORKER_ID") or "").strip()
        worker_id = configured_id or (
            f"{socket.gethostname()}-{os.getpid()}-{uuid4().hex[:8]}"
        )
        raw_required = (os.getenv("PROCESSING_WORKER_REQUIRED_JOB_TYPES") or "").strip()
        required_job_types = tuple(
            job.strip() for job in raw_required.split(",") if job.strip()
        )
        config = cls(
            enabled=_enabled(os.getenv("ENABLE_DURABLE_PROCESSING_WORKER")),
            worker_id=worker_id,
            required_job_types=required_job_types,
            poll_seconds=_float(
                "PROCESSING_WORKER_POLL_SECONDS", 2.0, 0.05, 60.0
            ),
            maximum_concurrency=_integer(
                "PROCESSING_WORKER_MAX_CONCURRENCY", 1, 1, 32
            ),
            shutdown_grace_seconds=_integer(
                "PROCESSING_WORKER_SHUTDOWN_GRACE_SECONDS", 30, 1, 600
            ),
            lease_seconds=_integer(
                "PROCESSING_JOB_LEASE_SECONDS", 90, 5, 3600
            ),
            heartbeat_seconds=_integer(
                "PROCESSING_JOB_HEARTBEAT_SECONDS", 30, 1, 1800
            ),
            retry_base_seconds=_integer(
                "PROCESSING_JOB_RETRY_BASE_SECONDS", 10, 1, 3600
            ),
            retry_multiplier=_float(
                "PROCESSING_JOB_RETRY_MULTIPLIER", 2.0, 1.0, 10.0
            ),
            retry_max_seconds=_integer(
                "PROCESSING_JOB_RETRY_MAX_SECONDS", 900, 1, 86400
            ),
            retry_jitter_percent=_integer(
                "PROCESSING_JOB_RETRY_JITTER_PERCENT", 20, 0, 100
            ),
            recovery_interval_seconds=_integer(
                "PROCESSING_JOB_RECOVERY_INTERVAL_SECONDS", 30, 1, 3600
            ),
            recovery_batch_size=_integer(
                "PROCESSING_JOB_RECOVERY_BATCH_SIZE", 100, 1, 1000
            ),
        )
        config.validate()
        return config

    def validate(self) -> None:
        if not self.worker_id or len(self.worker_id) > 200:
            raise JobOrchestrationError(
                "worker_not_configured", "Processing worker ID is invalid"
            )
        if self.heartbeat_seconds >= self.lease_seconds:
            raise JobOrchestrationError(
                "worker_not_configured",
                "Heartbeat interval must be shorter than the lease duration",
            )
        if self.retry_base_seconds > self.retry_max_seconds:
            raise JobOrchestrationError(
                "worker_not_configured",
                "Retry base delay cannot exceed the maximum delay",
            )
