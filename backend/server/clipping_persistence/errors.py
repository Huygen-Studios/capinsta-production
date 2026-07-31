from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

PERSISTENCE_ERROR_CATEGORIES = frozenset(
    {
        "entity_not_found",
        "duplicate_entity",
        "foreign_key_missing",
        "unauthorized",
        "forbidden",
        "invalid_contract",
        "schema_version_unsupported",
        "stale_revision",
        "invalid_job_transition",
        "invalid_job_progress",
        "idempotency_conflict",
        "idempotency_in_progress",
        "invalid_state",
        "conflict",
        "database_unavailable",
        "transaction_failed",
        "rls_policy_denied",
    }
)


@dataclass
class PersistenceError(Exception):
    category: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.category not in PERSISTENCE_ERROR_CATEGORIES:
            raise ValueError(f"unsupported persistence error category: {self.category}")
        Exception.__init__(self, self.message)

    def as_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "message": self.message,
            **({"details": self.details} if self.details else {}),
        }
