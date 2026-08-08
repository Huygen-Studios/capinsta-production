import asyncio
import os
import selectors
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

import pytest

psycopg = pytest.importorskip("psycopg")

from server.clipping_jobs.errors import JobOrchestrationError
from server.clipping_jobs.models import JobFailure
from server.clipping_jobs.policies import RetryBackoff
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_persistence import (
    AuthenticatedActor,
    DurableDatabase,
    ProcessingJobRepository,
)

ROOT = Path(__file__).resolve().parents[2]
DATABASE_URL = os.getenv("CLIPPING_PERSISTENCE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="Disposable PostgreSQL 17 test URL required"
)


def _run(coro):
    if os.name == "nt":
        with asyncio.Runner(
            loop_factory=lambda: asyncio.SelectorEventLoop(
                selectors.SelectSelector()
            )
        ) as runner:
            return runner.run(coro)
    return asyncio.run(coro)


def _prepare_database(*, include_lease_migration=True):
    bootstrap = """
      DROP SCHEMA IF EXISTS storage CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      DROP SCHEMA IF EXISTS auth CASCADE;
      CREATE SCHEMA public;
      CREATE SCHEMA auth;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
          CREATE ROLE service_role NOLOGIN BYPASSRLS;
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    """
    names = [
        "0014_clipping_persistence.sql",
        "0015_supabase_media_storage.sql",
    ]
    if include_lease_migration:
        names.append("0016_processing_job_leases.sql")
    migrations = [
        (ROOT / f"apps/web/migrations/{name}").read_text(encoding="utf-8")
        for name in names
    ]
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        name = connection.execute("SELECT current_database()").fetchone()[0]
        if "test" not in name.lower():
            raise RuntimeError("Refusing to reset a non-test database")
        connection.execute(bootstrap)
        for migration in migrations:
            connection.execute(migration)


def test_lease_migration_preserves_preexisting_active_rows():
    _prepare_database(include_lease_migration=False)
    user, job = uuid4(), uuid4()
    migration = (
        ROOT / "apps/web/migrations/0016_processing_job_leases.sql"
    ).read_text(encoding="utf-8")
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id) VALUES (%s)", (user,))
        connection.execute(
            """
            INSERT INTO processing_jobs(
              id,owner_user_id,job_type,status,input,attempt_count,worker_id
            ) VALUES (
              %s,%s,'media_probe','running',
              '{"schemaVersion":1,"jobType":"media_probe","metadata":{}}',
              1,'legacy-worker'
            )
            """,
            (job, user),
        )
        connection.execute(migration)
        row = connection.execute(
            """
            SELECT status,worker_id,claim_token,lease_expires_at
            FROM processing_jobs WHERE id=%s
            """,
            (job,),
        ).fetchone()
        assert row == ("retry_wait", None, None, None)
        assert connection.execute(
            """
            SELECT count(*) FROM pg_constraint
            WHERE conrelid='processing_jobs'::regclass
              AND conname IN (
                'processing_jobs_active_lease_check',
                'processing_jobs_inactive_lease_check'
              )
              AND convalidated
            """
        ).fetchone()[0] == 2


def _input(job_type="media_probe"):
    return {
        "schemaVersion": 1,
        "jobType": job_type,
        "metadata": {},
    }


async def _create(
    actor,
    *,
    job_type="media_probe",
    priority=0,
    max_attempts=3,
):
    return await ProcessingJobRepository(DurableDatabase(DATABASE_URL)).create(
        actor,
        job_type=job_type,
        input=_input(job_type),
        priority=priority,
        max_attempts=max_attempts,
    )


def test_atomic_claim_race_ordering_and_eligibility():
    _prepare_database()
    user = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id) VALUES (%s)", (user,))

    async def scenario():
        actor = AuthenticatedActor(user)
        job = await _create(actor)
        repository_a = ProcessingJobLeaseRepository(DurableDatabase(DATABASE_URL))
        repository_b = ProcessingJobLeaseRepository(DurableDatabase(DATABASE_URL))
        claims = await asyncio.gather(
            repository_a.claim_next_job(
                worker_id="worker-a",
                supported_job_types=("media_probe",),
                lease_seconds=90,
            ),
            repository_b.claim_next_job(
                worker_id="worker-b",
                supported_job_types=("media_probe",),
                lease_seconds=90,
            ),
        )
        won = [claim for claim in claims if claim is not None]
        assert len(won) == 1
        assert won[0].job_id == job["id"]
        assert won[0].attempt_number == 1
        assert won[0].revision == 2

        high = await _create(actor, priority=20)
        low = await _create(actor, priority=1)
        unsupported = await _create(actor, job_type="silence_analysis", priority=99)
        future = await _create(actor, priority=100)
        with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            connection.execute(
                """
                UPDATE processing_jobs SET status='cancelled',finished_at=now()
                WHERE id=%s
                """,
                (low["id"],),
            )
            connection.execute(
                """
                UPDATE processing_jobs SET available_at=now()+interval '1 hour'
                WHERE id=%s
                """,
                (future["id"],),
            )
        second = await repository_a.claim_next_job(
            worker_id="worker-a",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        assert second.job_id == high["id"]
        assert second.claim_token != won[0].claim_token
        assert (
            await repository_b.claim_next_job(
                worker_id="worker-b",
                supported_job_types=("media_probe",),
                lease_seconds=90,
            )
            is None
        )
        skipped = await repository_b.get_job(unsupported["id"])
        assert skipped["status"] == "queued"
        attempts = await repository_a.list_attempts(job["id"])
        assert len(attempts) == 1
        assert attempts[0]["claim_token"] == won[0].claim_token

    _run(scenario())


def test_lease_heartbeat_success_idempotency_and_cancellation():
    _prepare_database()
    user = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id) VALUES (%s)", (user,))

    async def scenario():
        actor = AuthenticatedActor(user)
        repository = ProcessingJobLeaseRepository(DurableDatabase(DATABASE_URL))
        job = await _create(actor)
        claim = await repository.claim_next_job(
            worker_id="worker-a",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        running = await repository.start_running(
            job["id"],
            worker_id="worker-a",
            claim_token=claim.claim_token,
            lease_seconds=120,
            expected_revision=claim.revision,
        )
        assert running["status"] == "running"
        assert running["attempt_count"] == 1
        old_lease = running["lease_expires_at"]
        heartbeat = await repository.heartbeat_job(
            job["id"],
            worker_id="worker-a",
            claim_token=claim.claim_token,
            lease_extension_seconds=180,
            progress=40,
            current_stage="testing",
        )
        assert heartbeat["lease_expires_at"] > old_lease
        assert float(heartbeat["progress"]) == 40
        with pytest.raises(JobOrchestrationError) as regression:
            await repository.heartbeat_job(
                job["id"],
                worker_id="worker-a",
                claim_token=claim.claim_token,
                lease_extension_seconds=90,
                progress=20,
            )
        assert regression.value.category == "invalid_job_progress"
        with pytest.raises(JobOrchestrationError) as stale:
            await repository.heartbeat_job(
                job["id"],
                worker_id="worker-a",
                claim_token=claim.claim_token,
                lease_extension_seconds=90,
                expected_revision=running["revision"],
            )
        assert stale.value.category == "job_lease_lost"
        for worker_id, token, category in (
            ("worker-b", claim.claim_token, "worker_mismatch"),
            ("worker-a", uuid4(), "claim_token_mismatch"),
        ):
            with pytest.raises(JobOrchestrationError) as error:
                await repository.heartbeat_job(
                    job["id"],
                    worker_id=worker_id,
                    claim_token=token,
                    lease_extension_seconds=90,
                )
            assert error.value.category == category

        output = {"schemaVersion": 1, "metadata": {"ok": True}}
        completed = await repository.complete_job_success(
            job["id"],
            worker_id="worker-a",
            claim_token=claim.claim_token,
            output=output,
        )
        assert completed["status"] == "succeeded"
        assert float(completed["progress"]) == 100
        assert completed["claim_token"] is None
        assert completed["lease_expires_at"] is None
        assert completed["finished_at"] is not None
        replay = await repository.complete_job_success(
            job["id"],
            worker_id="worker-a",
            claim_token=claim.claim_token,
            output=output,
        )
        assert replay["status"] == "succeeded"
        with pytest.raises(JobOrchestrationError):
            await repository.complete_job_success(
                job["id"],
                worker_id="worker-a",
                claim_token=claim.claim_token,
                output={"different": True},
            )
        with pytest.raises(JobOrchestrationError):
            await repository.heartbeat_job(
                job["id"],
                worker_id="worker-a",
                claim_token=claim.claim_token,
                lease_extension_seconds=90,
            )

        queued = await _create(actor)
        cancelled = await repository.request_cancellation(
            queued["id"], reason="No longer needed"
        )
        assert cancelled["status"] == "cancelled"
        assert (
            await repository.request_cancellation(queued["id"])
        )["status"] == "cancelled"

        active = await _create(actor)
        active_claim = await repository.claim_next_job(
            worker_id="worker-a",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        requested = await repository.request_cancellation(
            active["id"], reason="User request"
        )
        assert requested["status"] == "cancel_requested"
        assert await repository.cancellation_requested(
            active["id"],
            worker_id="worker-a",
            claim_token=active_claim.claim_token,
        )
        acknowledged = await repository.acknowledge_cancellation(
            active["id"],
            worker_id="worker-a",
            claim_token=active_claim.claim_token,
        )
        assert acknowledged["status"] == "cancelled"

        expiring = await _create(actor)
        expiring_claim = await repository.claim_next_job(
            worker_id="worker-a",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            connection.execute(
                """
                UPDATE processing_jobs SET lease_expires_at=now()-interval '1 second'
                WHERE id=%s
                """,
                (expiring["id"],),
            )
        with pytest.raises(JobOrchestrationError) as expired:
            await repository.heartbeat_job(
                expiring["id"],
                worker_id="worker-a",
                claim_token=expiring_claim.claim_token,
                lease_extension_seconds=90,
            )
        assert expired.value.category == "job_lease_expired"

    _run(scenario())


def test_retry_failure_limits_promotion_and_rls():
    _prepare_database()
    user = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id) VALUES (%s)", (user,))

    async def scenario():
        actor = AuthenticatedActor(user)
        repository = ProcessingJobLeaseRepository(DurableDatabase(DATABASE_URL))
        retry_job = await _create(actor, max_attempts=2)
        claim = await repository.claim_next_job(
            worker_id="worker-a",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        retry_at = datetime.now(timezone.utc) + timedelta(minutes=5)
        retry = await repository.record_failure(
            retry_job["id"],
            worker_id="worker-a",
            claim_token=claim.claim_token,
            failure=JobFailure(
                "temporary",
                "Temporary failure at https://signed.invalid/x?token=secret",
                True,
                {"token": "redacted"},
            ),
            retry_at=retry_at,
        )
        assert retry["status"] == "retry_wait"
        assert retry["next_retry_at"] >= retry_at - timedelta(seconds=1)
        assert "token" not in retry["error"]["details"]
        assert retry["failure_message"] == "Temporary failure at [redacted]"
        assert (
            await repository.claim_next_job(
                worker_id="worker-b",
                supported_job_types=("media_probe",),
                lease_seconds=90,
            )
            is None
        )
        with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            connection.execute(
                """
                UPDATE processing_jobs SET next_retry_at=now()-interval '1 second',
                  available_at=now()-interval '1 second' WHERE id=%s
                """,
                (retry_job["id"],),
            )
        sweep = await repository.sweep_recovery(
            batch_size=10,
            backoff=RetryBackoff(jitter_percent=0),
        )
        assert sweep["retriesPromoted"] == 1
        second_claim = await repository.claim_next_job(
            worker_id="worker-b",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        exhausted = await repository.record_failure(
            retry_job["id"],
            worker_id="worker-b",
            claim_token=second_claim.claim_token,
            failure=JobFailure("temporary", "Still failing", True),
            retry_at=datetime.now(timezone.utc) + timedelta(seconds=10),
        )
        assert exhausted["status"] == "failed"

        permanent_job = await _create(actor)
        permanent_claim = await repository.claim_next_job(
            worker_id="worker-a",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        permanent = await repository.record_failure(
            permanent_job["id"],
            worker_id="worker-a",
            claim_token=permanent_claim.claim_token,
            failure=JobFailure("invalid_input", "Invalid input", False),
            retry_at=None,
        )
        assert permanent["status"] == "failed"

    _run(scenario())

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,true)", (str(user),)
        )
        assert len(
            connection.execute(
                "SELECT id,status FROM processing_jobs ORDER BY id"
            ).fetchall()
        ) == 2
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("SELECT claim_token FROM processing_jobs")
        connection.rollback()
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,true)", (str(user),)
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                """
                UPDATE processing_jobs SET worker_id='browser',
                  claim_token=%s,attempt_count=attempt_count+1
                """,
                (uuid4(),),
            )
        connection.rollback()
        connection.execute("SET ROLE authenticated")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("SELECT * FROM processing_job_attempts")

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE service_role")
        assert connection.execute(
            "SELECT count(*) FROM processing_job_attempts"
        ).fetchone()[0] == 3


def test_crash_recovery_and_stale_worker_protection():
    _prepare_database()
    user = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id) VALUES (%s)", (user,))

    async def scenario():
        actor = AuthenticatedActor(user)
        repository_a = ProcessingJobLeaseRepository(DurableDatabase(DATABASE_URL))
        repository_b = ProcessingJobLeaseRepository(DurableDatabase(DATABASE_URL))
        job = await _create(actor, max_attempts=3)
        claim_a = await repository_a.claim_next_job(
            worker_id="worker-a",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        await repository_a.start_running(
            job["id"],
            worker_id="worker-a",
            claim_token=claim_a.claim_token,
            lease_seconds=90,
        )
        with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            connection.execute(
                """
                UPDATE processing_jobs
                SET lease_expires_at=now()-interval '1 second'
                WHERE id=%s
                """,
                (job["id"],),
            )
        sweeps = await asyncio.gather(
            repository_a.sweep_recovery(
                batch_size=10, backoff=RetryBackoff(jitter_percent=0)
            ),
            repository_b.sweep_recovery(
                batch_size=10, backoff=RetryBackoff(jitter_percent=0)
            ),
        )
        assert sum(int(x["leasesRecovered"]) for x in sweeps) == 1
        recovered = await repository_a.get_job(job["id"])
        assert recovered["status"] == "retry_wait"
        with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            connection.execute(
                """
                UPDATE processing_jobs SET next_retry_at=now()-interval '1 second',
                  available_at=now()-interval '1 second' WHERE id=%s
                """,
                (job["id"],),
            )
        await repository_b.sweep_recovery(
            batch_size=10, backoff=RetryBackoff(jitter_percent=0)
        )
        claim_b = await repository_b.claim_next_job(
            worker_id="worker-b",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        assert claim_b.attempt_number == 2
        assert claim_b.claim_token != claim_a.claim_token
        with pytest.raises(JobOrchestrationError):
            await repository_a.complete_job_success(
                job["id"],
                worker_id="worker-a",
                claim_token=claim_a.claim_token,
                output={"stale": True},
            )
        await repository_b.start_running(
            job["id"],
            worker_id="worker-b",
            claim_token=claim_b.claim_token,
            lease_seconds=90,
        )
        completed = await repository_b.complete_job_success(
            job["id"],
            worker_id="worker-b",
            claim_token=claim_b.claim_token,
            output={"worker": "b"},
        )
        assert completed["status"] == "succeeded"
        attempts = await repository_b.list_attempts(job["id"])
        assert [attempt["status"] for attempt in attempts] == [
            "lease_expired",
            "succeeded",
        ]

        exhausted_job = await _create(actor, max_attempts=1)
        exhausted_claim = await repository_a.claim_next_job(
            worker_id="worker-a",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        cancel_job = await _create(actor)
        cancel_claim = await repository_b.claim_next_job(
            worker_id="worker-b",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        await repository_b.request_cancellation(
            cancel_job["id"], reason="cancel during crash"
        )
        fresh_job = await _create(actor)
        fresh_claim = await repository_a.claim_next_job(
            worker_id="worker-a",
            supported_job_types=("media_probe",),
            lease_seconds=90,
        )
        await repository_a.heartbeat_job(
            fresh_job["id"],
            worker_id="worker-a",
            claim_token=fresh_claim.claim_token,
            lease_extension_seconds=180,
        )
        with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            connection.execute(
                """
                UPDATE processing_jobs SET lease_expires_at=now()-interval '1 second'
                WHERE id IN (%s,%s)
                """,
                (exhausted_job["id"], cancel_job["id"]),
            )
        recovered_terminal = await repository_a.sweep_recovery(
            batch_size=10, backoff=RetryBackoff(jitter_percent=0)
        )
        assert recovered_terminal["leasesRecovered"] == 2
        assert (await repository_a.get_job(exhausted_job["id"]))[
            "status"
        ] == "failed"
        assert (await repository_a.get_job(cancel_job["id"]))[
            "status"
        ] == "cancelled"
        assert (await repository_a.get_job(fresh_job["id"]))[
            "status"
        ] == "claimed"
        assert exhausted_claim.claim_token != cancel_claim.claim_token

    _run(scenario())
