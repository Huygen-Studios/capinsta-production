from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError

from .errors import JobOrchestrationError
from .models import JobClaim, JobFailure
from .policies import RetryBackoff

try:
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    Jsonb = None

ACTIVE_STATUSES = frozenset({"claimed", "running", "cancel_requested"})
TERMINAL_STATUSES = frozenset({"succeeded", "failed", "cancelled", "expired"})
RECOVERY_ADVISORY_LOCK_KEY = 8_234_502_317
_SENSITIVE_KEYS = (
    "authorization",
    "password",
    "secret",
    "token",
    "signedurl",
    "databaseurl",
    "connectionstring",
)
_SENSITIVE_TEXT = re.compile(
    r"(https?://\S+|bearer\s+\S+|"
    r"(?:api[_-]?key|token|secret|password|database[_-]?url)"
    r"\s*[:=]\s*\S+)",
    re.IGNORECASE,
)
_SAFE_CODE = re.compile(r"^[a-z][a-z0-9_]{0,99}$")


def _json(value: Any) -> Any:
    return Jsonb(value) if Jsonb is not None else value


def _translate(exc: PersistenceError) -> JobOrchestrationError:
    return JobOrchestrationError(
        "database_temporarily_unavailable", exc.message
    )


def _safe_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _safe_value(item)
            for key, item in value.items()
            if not any(
                marker in str(key).replace("_", "").lower()
                for marker in _SENSITIVE_KEYS
            )
        }
    if isinstance(value, list):
        return [_safe_value(item) for item in value[:100]]
    if isinstance(value, str):
        return _SENSITIVE_TEXT.sub("[redacted]", value.replace("\x00", ""))[
            :1000
        ]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:1000]


def _failure_payload(failure: JobFailure) -> dict[str, Any]:
    payload = failure.as_dict()
    if not _SAFE_CODE.fullmatch(failure.code):
        payload["code"] = "processor_failed"
    payload["details"] = _safe_value(payload["details"])
    payload["message"] = _safe_value(payload["message"])
    return payload


class ProcessingJobLeaseRepository:
    """Trusted worker mutations; never expose these methods to browser roles."""

    def __init__(self, database: DurableDatabase) -> None:
        self.database = database

    @staticmethod
    async def _locked_job(connection: Any, job_id: UUID) -> dict[str, Any]:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                SELECT j.*,now() AS database_now
                FROM processing_jobs j WHERE j.id=%s FOR UPDATE
                """,
                (job_id,),
            )
            row = await cursor.fetchone()
        if row is None:
            raise JobOrchestrationError(
                "job_not_found", "Processing job was not found"
            )
        return dict(row)

    @staticmethod
    def _validate_lease(
        row: dict[str, Any],
        *,
        worker_id: str,
        claim_token: UUID,
        expected_revision: int | None = None,
        allowed_statuses: frozenset[str] = ACTIVE_STATUSES,
    ) -> None:
        if row["status"] not in allowed_statuses:
            raise JobOrchestrationError(
                "job_lease_lost",
                "Processing job is no longer owned by an active attempt",
                {"status": row["status"]},
            )
        if row["worker_id"] != worker_id:
            raise JobOrchestrationError(
                "worker_mismatch", "Processing job is owned by another worker"
            )
        if row["claim_token"] != claim_token:
            raise JobOrchestrationError(
                "claim_token_mismatch", "Processing job claim token does not match"
            )
        if (
            row["lease_expires_at"] is None
            or row["lease_expires_at"] <= row["database_now"]
        ):
            raise JobOrchestrationError(
                "job_lease_expired", "Processing job lease has expired"
            )
        if expected_revision is not None and row["revision"] != expected_revision:
            raise JobOrchestrationError(
                "job_lease_lost",
                "Processing job revision is stale",
                {
                    "expectedRevision": expected_revision,
                    "actualRevision": row["revision"],
                },
            )

    async def claim_next_job(
        self,
        *,
        worker_id: str,
        supported_job_types: tuple[str, ...],
        lease_seconds: int,
    ) -> JobClaim | None:
        if not supported_job_types:
            return None
        if not worker_id or not 1 <= lease_seconds <= 3600:
            raise JobOrchestrationError(
                "job_not_claimable", "Worker identity or lease duration is invalid"
            )
        claim_token = uuid4()
        try:
            async with self.database.transaction() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        WITH candidate AS (
                          SELECT id
                          FROM processing_jobs
                          WHERE status='queued'
                            AND available_at <= now()
                            AND claim_token IS NULL
                            AND lease_expires_at IS NULL
                            AND attempt_count < max_attempts
                            AND job_type = ANY(%s::text[])
                          ORDER BY priority DESC,available_at ASC,
                            created_at ASC,id ASC
                          FOR UPDATE SKIP LOCKED
                          LIMIT 1
                        )
                        UPDATE processing_jobs AS j SET
                          status='claimed',
                          worker_id=%s,
                          last_worker_id=%s,
                          claim_token=%s,
                          lease_expires_at=now()+(%s * interval '1 second'),
                          claimed_at=now(),
                          last_attempt_started_at=now(),
                          heartbeat_at=now(),
                          attempt_count=j.attempt_count+1,
                          current_stage='claimed',
                          next_retry_at=NULL,
                          finished_at=NULL,
                          revision=j.revision+1,
                          updated_at=now()
                        FROM candidate
                        WHERE j.id=candidate.id
                        RETURNING j.*
                        """,
                        (
                            list(supported_job_types),
                            worker_id,
                            worker_id,
                            claim_token,
                            lease_seconds,
                        ),
                    )
                    row = await cursor.fetchone()
                    if row is None:
                        return None
                    job = dict(row)
                    await cursor.execute(
                        """
                        INSERT INTO processing_job_attempts (
                          job_id,attempt_number,worker_id,claim_token,status,
                          lease_expires_at
                        ) VALUES (%s,%s,%s,%s,'claimed',%s)
                        """,
                        (
                            job["id"],
                            job["attempt_count"],
                            worker_id,
                            claim_token,
                            job["lease_expires_at"],
                        ),
                    )
                    return JobClaim.from_row(job)
        except PersistenceError as exc:
            raise _translate(exc) from exc

    async def start_running(
        self,
        job_id: UUID,
        *,
        worker_id: str,
        claim_token: UUID,
        lease_seconds: int,
        current_stage: str | None = None,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            job = await self._locked_job(connection, job_id)
            self._validate_lease(
                job,
                worker_id=worker_id,
                claim_token=claim_token,
                expected_revision=expected_revision,
                allowed_statuses=frozenset({"claimed", "running"}),
            )
            if job["status"] == "running":
                return job
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE processing_jobs SET status='running',
                      current_stage=COALESCE(%s,current_stage),
                      started_at=COALESCE(started_at,now()),
                      heartbeat_at=now(),
                      lease_expires_at=GREATEST(
                        lease_expires_at,
                        now()+(%s * interval '1 second')
                      ),
                      revision=revision+1,updated_at=now()
                    WHERE id=%s RETURNING *
                    """,
                    (current_stage, lease_seconds, job_id),
                )
                updated = dict(await cursor.fetchone())
                await cursor.execute(
                    """
                    UPDATE processing_job_attempts SET status='running',
                      started_at=COALESCE(started_at,now()),
                      lease_expires_at=%s
                    WHERE job_id=%s AND attempt_number=%s
                    """,
                    (
                        updated["lease_expires_at"],
                        job_id,
                        job["attempt_count"],
                    ),
                )
                return updated

    async def heartbeat_job(
        self,
        job_id: UUID,
        *,
        worker_id: str,
        claim_token: UUID,
        lease_extension_seconds: int,
        progress: float | None = None,
        current_stage: str | None = None,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        if progress is not None and not 0 <= progress <= 100:
            raise JobOrchestrationError(
                "invalid_job_progress", "Job progress must be between 0 and 100"
            )
        async with self.database.transaction() as connection:
            job = await self._locked_job(connection, job_id)
            self._validate_lease(
                job,
                worker_id=worker_id,
                claim_token=claim_token,
                expected_revision=expected_revision,
            )
            if progress is not None and Decimal(str(progress)) < job["progress"]:
                raise JobOrchestrationError(
                    "invalid_job_progress", "Job progress cannot regress"
                )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE processing_jobs SET
                      heartbeat_at=now(),
                      lease_expires_at=now()+(%s * interval '1 second'),
                      progress=COALESCE(%s,progress),
                      current_stage=COALESCE(%s,current_stage),
                      revision=revision+1,updated_at=now()
                    WHERE id=%s RETURNING *
                    """,
                    (
                        lease_extension_seconds,
                        progress,
                        current_stage,
                        job_id,
                    ),
                )
                updated = dict(await cursor.fetchone())
                await cursor.execute(
                    """
                    UPDATE processing_job_attempts SET lease_expires_at=%s,
                      status=CASE WHEN %s='cancel_requested'
                        THEN 'cancel_requested' ELSE status END
                    WHERE job_id=%s AND attempt_number=%s
                    """,
                    (
                        updated["lease_expires_at"],
                        updated["status"],
                        job_id,
                        job["attempt_count"],
                    ),
                )
                return updated

    async def cancellation_requested(
        self,
        job_id: UUID,
        *,
        worker_id: str,
        claim_token: UUID,
    ) -> bool:
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT j.*,now() AS database_now
                    FROM processing_jobs j WHERE id=%s
                    """,
                    (job_id,),
                )
                row = await cursor.fetchone()
            if row is None:
                raise JobOrchestrationError(
                    "job_not_found", "Processing job was not found"
                )
            job = dict(row)
            self._validate_lease(
                job, worker_id=worker_id, claim_token=claim_token
            )
            return job["status"] == "cancel_requested"

    async def complete_job_success(
        self,
        job_id: UUID,
        *,
        worker_id: str,
        claim_token: UUID,
        output: dict[str, Any],
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            job = await self._locked_job(connection, job_id)
            if job["status"] == "succeeded":
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        SELECT claim_token FROM processing_job_attempts
                        WHERE job_id=%s AND attempt_number=%s
                        """,
                        (job_id, job["attempt_count"]),
                    )
                    attempt = await cursor.fetchone()
                if (
                    attempt
                    and attempt["claim_token"] == claim_token
                    and job["last_worker_id"] == worker_id
                    and job["output"] == output
                ):
                    return job
                raise JobOrchestrationError(
                    "invalid_job_transition",
                    "Successful output is already committed for another result",
                )
            self._validate_lease(
                job,
                worker_id=worker_id,
                claim_token=claim_token,
                allowed_statuses=frozenset({"claimed", "running"}),
            )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE processing_jobs SET status='succeeded',progress=100,
                      output=%s,error=NULL,failure_code=NULL,
                      failure_message=NULL,finished_at=now(),
                      worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,
                      current_stage='completed',revision=revision+1,updated_at=now()
                    WHERE id=%s RETURNING *
                    """,
                    (_json(_safe_value(output)), job_id),
                )
                updated = dict(await cursor.fetchone())
                await cursor.execute(
                    """
                    UPDATE processing_job_attempts SET status='succeeded',
                      finished_at=now(),lease_expires_at=NULL,
                      output_summary=%s
                    WHERE job_id=%s AND attempt_number=%s
                    """,
                    (
                        _json({"keys": sorted(output)[:50]}),
                        job_id,
                        job["attempt_count"],
                    ),
                )
                return updated

    async def record_failure(
        self,
        job_id: UUID,
        *,
        worker_id: str,
        claim_token: UUID,
        failure: JobFailure,
        retry_at: datetime | None,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            job = await self._locked_job(connection, job_id)
            self._validate_lease(
                job, worker_id=worker_id, claim_token=claim_token
            )
            cancelled = job["status"] == "cancel_requested"
            retry = (
                failure.retryable
                and not cancelled
                and job["attempt_count"] < job["max_attempts"]
            )
            status = "cancelled" if cancelled else ("retry_wait" if retry else "failed")
            if retry and retry_at is None:
                raise JobOrchestrationError(
                    "invalid_job_transition",
                    "Retryable failure requires a durable retry timestamp",
                )
            if retry and retry_at <= job["database_now"]:
                raise JobOrchestrationError(
                    "invalid_job_transition",
                    "Retry timestamp must be in the future",
                )
            payload = _failure_payload(failure)
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE processing_jobs SET status=%s,error=%s,
                      failure_code=%s,failure_message=%s,
                      available_at=CASE WHEN %s THEN %s::timestamptz
                        ELSE available_at END,
                      next_retry_at=CASE WHEN %s THEN %s::timestamptz
                        ELSE NULL END,
                      finished_at=CASE WHEN %s IN ('failed','cancelled')
                        THEN now() ELSE NULL END,
                      cancelled_at=CASE WHEN %s='cancelled' THEN now()
                        ELSE cancelled_at END,
                      worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,
                      current_stage=%s,revision=revision+1,updated_at=now()
                    WHERE id=%s RETURNING *
                    """,
                    (
                        status,
                        _json(payload),
                        payload["code"],
                        payload["message"],
                        retry,
                        retry_at,
                        retry,
                        retry_at,
                        status,
                        status,
                        status,
                        job_id,
                    ),
                )
                updated = dict(await cursor.fetchone())
                await cursor.execute(
                    """
                    UPDATE processing_job_attempts SET status=%s,
                      finished_at=now(),lease_expires_at=NULL,error=%s
                    WHERE job_id=%s AND attempt_number=%s
                    """,
                    (
                        status,
                        _json(payload),
                        job_id,
                        job["attempt_count"],
                    ),
                )
                return updated

    async def request_cancellation(
        self, job_id: UUID, *, reason: str | None = None
    ) -> dict[str, Any]:
        safe_reason = _safe_value(reason) if reason else None
        async with self.database.transaction() as connection:
            job = await self._locked_job(connection, job_id)
            if job["status"] in TERMINAL_STATUSES:
                return job
            if job["status"] == "cancel_requested":
                return job
            if job["status"] in {"queued", "retry_wait"}:
                status = "cancelled"
            elif job["status"] in {"claimed", "running"}:
                status = "cancel_requested"
            else:
                raise JobOrchestrationError(
                    "invalid_job_transition",
                    "Processing job cannot be cancelled in its current state",
                )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE processing_jobs SET status=%s,cancel_reason=%s,
                      cancel_requested_at=COALESCE(cancel_requested_at,now()),
                      cancelled_at=CASE WHEN %s='cancelled' THEN now()
                        ELSE cancelled_at END,
                      finished_at=CASE WHEN %s='cancelled' THEN now()
                        ELSE finished_at END,
                      worker_id=CASE WHEN %s='cancelled' THEN NULL ELSE worker_id END,
                      claim_token=CASE WHEN %s='cancelled' THEN NULL ELSE claim_token END,
                      lease_expires_at=CASE WHEN %s='cancelled'
                        THEN NULL ELSE lease_expires_at END,
                      next_retry_at=NULL,revision=revision+1,updated_at=now()
                    WHERE id=%s RETURNING *
                    """,
                    (
                        status,
                        safe_reason,
                        status,
                        status,
                        status,
                        status,
                        status,
                        job_id,
                    ),
                )
                updated = dict(await cursor.fetchone())
                if job["attempt_count"] > 0:
                    await cursor.execute(
                        """
                        UPDATE processing_job_attempts SET status=%s,
                          finished_at=CASE WHEN %s='cancelled'
                            THEN now() ELSE finished_at END,
                          lease_expires_at=CASE WHEN %s='cancelled'
                            THEN NULL ELSE lease_expires_at END
                        WHERE job_id=%s AND attempt_number=%s
                        """,
                        (
                            status,
                            status,
                            status,
                            job_id,
                            job["attempt_count"],
                        ),
                    )
                return updated

    async def acknowledge_cancellation(
        self,
        job_id: UUID,
        *,
        worker_id: str,
        claim_token: UUID,
    ) -> dict[str, Any]:
        async with self.database.transaction() as connection:
            job = await self._locked_job(connection, job_id)
            self._validate_lease(
                job,
                worker_id=worker_id,
                claim_token=claim_token,
                allowed_statuses=frozenset({"cancel_requested"}),
            )
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE processing_jobs SET status='cancelled',
                      cancelled_at=now(),finished_at=now(),next_retry_at=NULL,
                      worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,
                      current_stage='cancelled',revision=revision+1,updated_at=now()
                    WHERE id=%s RETURNING *
                    """,
                    (job_id,),
                )
                updated = dict(await cursor.fetchone())
                await cursor.execute(
                    """
                    UPDATE processing_job_attempts SET status='cancelled',
                      finished_at=now(),lease_expires_at=NULL
                    WHERE job_id=%s AND attempt_number=%s
                    """,
                    (job_id, job["attempt_count"]),
                )
                return updated

    async def sweep_recovery(
        self,
        *,
        batch_size: int,
        backoff: RetryBackoff,
    ) -> dict[str, int | bool]:
        batch_size = min(max(batch_size, 1), 1000)
        summary: dict[str, int | bool] = {
            "lockAcquired": False,
            "leasesRecovered": 0,
            "retriesPromoted": 0,
        }
        async with self.database.transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT pg_try_advisory_xact_lock(%s) AS acquired",
                    (RECOVERY_ADVISORY_LOCK_KEY,),
                )
                if not (await cursor.fetchone())["acquired"]:
                    return summary
                summary["lockAcquired"] = True
                await cursor.execute(
                    """
                    SELECT j.*,now() AS database_now
                    FROM processing_jobs j
                    WHERE status IN ('claimed','running','cancel_requested')
                      AND lease_expires_at <= now()
                    ORDER BY lease_expires_at,id
                    FOR UPDATE SKIP LOCKED
                    LIMIT %s
                    """,
                    (batch_size,),
                )
                expired = [dict(row) for row in await cursor.fetchall()]
                for job in expired:
                    if job["status"] == "cancel_requested":
                        status = "cancelled"
                        retry_at = None
                    elif job["attempt_count"] < job["max_attempts"]:
                        status = "retry_wait"
                        retry_at = job["database_now"] + timedelta(
                            seconds=backoff.delay_seconds(job["attempt_count"])
                        )
                    else:
                        status = "failed"
                        retry_at = None
                    failure = JobFailure(
                        code="worker_lease_expired",
                        message="The processing worker lease expired",
                        retryable=status == "retry_wait",
                        details={
                            "attemptNumber": job["attempt_count"],
                            "workerId": job["worker_id"],
                        },
                    )
                    payload = _failure_payload(failure)
                    await cursor.execute(
                        """
                        UPDATE processing_jobs SET status=%s,error=%s,
                          failure_code=%s,failure_message=%s,
                          available_at=COALESCE(%s,available_at),
                          next_retry_at=%s,
                          cancelled_at=CASE WHEN %s='cancelled'
                            THEN now() ELSE cancelled_at END,
                          finished_at=CASE WHEN %s IN ('failed','cancelled')
                            THEN now() ELSE NULL END,
                          worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,
                          current_stage=%s,revision=revision+1,updated_at=now()
                        WHERE id=%s AND lease_expires_at=%s
                        """,
                        (
                            status,
                            _json(payload),
                            failure.code,
                            failure.message,
                            retry_at,
                            retry_at,
                            status,
                            status,
                            status,
                            job["id"],
                            job["lease_expires_at"],
                        ),
                    )
                    await cursor.execute(
                        """
                        UPDATE processing_job_attempts SET status=%s,
                          finished_at=now(),lease_expires_at=NULL,error=%s
                        WHERE job_id=%s AND attempt_number=%s
                        """,
                        (
                            "cancelled"
                            if status == "cancelled"
                            else "lease_expired",
                            _json(payload),
                            job["id"],
                            job["attempt_count"],
                        ),
                    )
                    summary["leasesRecovered"] += 1

                await cursor.execute(
                    """
                    WITH eligible AS (
                      SELECT id FROM processing_jobs
                      WHERE status='retry_wait'
                        AND COALESCE(next_retry_at,available_at) <= now()
                        AND attempt_count < max_attempts
                        AND claim_token IS NULL
                        AND lease_expires_at IS NULL
                      ORDER BY COALESCE(next_retry_at,available_at),id
                      FOR UPDATE SKIP LOCKED
                      LIMIT %s
                    )
                    UPDATE processing_jobs AS j SET status='queued',
                      progress=0,current_stage='queued',
                      next_retry_at=NULL,revision=j.revision+1,updated_at=now()
                    FROM eligible WHERE j.id=eligible.id
                    RETURNING j.id
                    """,
                    (batch_size,),
                )
                summary["retriesPromoted"] = len(await cursor.fetchall())
        return summary

    async def get_job(self, job_id: UUID) -> dict[str, Any]:
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT * FROM processing_jobs WHERE id=%s", (job_id,)
                )
                row = await cursor.fetchone()
        if row is None:
            raise JobOrchestrationError(
                "job_not_found", "Processing job was not found"
            )
        return dict(row)

    async def list_attempts(self, job_id: UUID) -> list[dict[str, Any]]:
        async with self.database.connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT * FROM processing_job_attempts
                    WHERE job_id=%s ORDER BY attempt_number
                    """,
                    (job_id,),
                )
                return [dict(row) for row in await cursor.fetchall()]


class ProcessingJobRecoveryService:
    def __init__(
        self,
        repository: ProcessingJobLeaseRepository,
        *,
        backoff: RetryBackoff,
        batch_size: int,
    ) -> None:
        self.repository = repository
        self.backoff = backoff
        self.batch_size = batch_size

    async def run_once(self) -> dict[str, int | bool]:
        return await self.repository.sweep_recovery(
            batch_size=self.batch_size, backoff=self.backoff
        )
