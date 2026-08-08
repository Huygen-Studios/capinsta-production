from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from uuid import UUID


@dataclass(frozen=True)
class JobClaim:
    job_id: UUID
    job_type: str
    input: dict[str, Any]
    attempt_number: int
    worker_id: str
    claim_token: UUID
    lease_expires_at: datetime
    revision: int
    execution_timeout_seconds: int | None
    maximum_attempts: int = 3
    project_id: str | None = None
    media_asset_id: UUID | None = None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "JobClaim":
        return cls(
            job_id=row["id"],
            job_type=row["job_type"],
            input=row["input"],
            attempt_number=row["attempt_count"],
            maximum_attempts=row["max_attempts"],
            worker_id=row["worker_id"],
            claim_token=row["claim_token"],
            lease_expires_at=row["lease_expires_at"],
            revision=row["revision"],
            execution_timeout_seconds=row["execution_timeout_seconds"],
            project_id=row["project_id"],
            media_asset_id=row["media_asset_id"],
        )


@dataclass(frozen=True)
class JobExecutionResult:
    output: dict[str, Any] = field(default_factory=dict)
    finalized: bool = False


@dataclass(frozen=True)
class JobFailure:
    code: str
    message: str
    retryable: bool
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "details": self.details,
            "occurredAt": datetime.now(timezone.utc).isoformat(),
        }


HeartbeatCallback = Callable[..., Awaitable[dict[str, Any]]]
CancellationCallback = Callable[[], Awaitable[bool]]


@dataclass
class JobExecutionContext:
    job_id: UUID
    attempt_number: int
    worker_id: str
    claim_token: UUID
    heartbeat_callback: HeartbeatCallback
    cancellation_callback: CancellationCallback
    shutdown_event: asyncio.Event
    cancellation_event: asyncio.Event = field(default_factory=asyncio.Event)
    lease_lost_event: asyncio.Event = field(default_factory=asyncio.Event)
    maximum_attempts: int = 1
    execution_timeout_seconds: int = 1

    async def heartbeat(
        self,
        *,
        progress: float | None = None,
        current_stage: str | None = None,
    ) -> dict[str, Any]:
        return await self.heartbeat_callback(
            progress=progress, current_stage=current_stage
        )

    async def is_cancelled(self) -> bool:
        return self.shutdown_event.is_set() or await self.cancellation_callback()

    async def raise_if_cancelled(self) -> None:
        if await self.is_cancelled():
            raise asyncio.CancelledError
