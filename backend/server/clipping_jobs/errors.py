from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

JOB_ERROR_CATEGORIES = frozenset(
    {
        "job_not_found",
        "job_not_claimable",
        "job_lease_lost",
        "job_lease_expired",
        "worker_mismatch",
        "claim_token_mismatch",
        "unsupported_job_type",
        "handler_not_registered",
        "invalid_handler_input",
        "invalid_handler_output",
        "invalid_job_transition",
        "invalid_job_progress",
        "job_cancelled",
        "job_retry_exhausted",
        "recovery_lock_unavailable",
        "database_temporarily_unavailable",
        "worker_shutting_down",
        "worker_not_configured",
        "required_handler_missing",
    }
)


@dataclass
class JobOrchestrationError(Exception):
    category: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.category not in JOB_ERROR_CATEGORIES:
            raise ValueError(f"unsupported job error category: {self.category}")
        Exception.__init__(self, self.message)

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.category,
            "message": self.message,
            **({"details": self.details} if self.details else {}),
        }


class ProcessingJobFailure(Exception):
    """Safe handler failure; details must not contain secrets."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool,
        details: dict[str, Any] | None = None,
        finalized: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.safe_message = message
        self.retryable = retryable
        self.details = details or {}
        self.finalized = finalized
