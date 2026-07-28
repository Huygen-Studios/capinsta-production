import asyncio
import os
from pathlib import Path

import pytest

import test_clipping_orchestration_postgres as base
from server.clipping_jobs.models import JobExecutionContext
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_orchestration.contracts import ConversionRequest, DeriveRequest
from server.clipping_orchestration.repository import ClippingOrchestrationRepository
from server.clipping_persistence.database import DurableDatabase
from server.clipping_runtime.client import ClippingRuntimeClient
from server.clipping_runtime.config import ClippingRuntimeConfig
from server.clipping_runtime.handlers import (
    ProjectConversionJobHandler,
    ProjectDerivationJobHandler,
)
from server.clipping_runtime.repository import ClippingRuntimeRepository

DATABASE_URL = os.getenv("CLIPPING_PERSISTENCE_TEST_DATABASE_URL")
ROOT = Path(__file__).parents[2]
EXE = ".exe" if os.name == "nt" else ""
BINARY = ROOT / "target" / "debug" / f"capinsta-clipping-runtime{EXE}"

pytestmark = pytest.mark.skipif(
    not DATABASE_URL or not BINARY.exists(),
    reason="Disposable PostgreSQL and real clipping runtime are required",
)


async def _context(repository, claim):
    running = await repository.start_running(
        claim.job_id,
        worker_id=claim.worker_id,
        claim_token=claim.claim_token,
        lease_seconds=90,
        current_stage="starting",
        expected_revision=claim.revision,
    )

    async def heartbeat(**kwargs):
        return await repository.heartbeat_job(
            claim.job_id,
            worker_id=claim.worker_id,
            claim_token=claim.claim_token,
            lease_extension_seconds=90,
            **kwargs,
        )

    async def not_cancelled():
        return False

    return JobExecutionContext(
        job_id=claim.job_id,
        attempt_number=claim.attempt_number,
        maximum_attempts=claim.maximum_attempts,
        worker_id=claim.worker_id,
        claim_token=claim.claim_token,
        heartbeat_callback=heartbeat,
        cancellation_callback=not_cancelled,
        shutdown_event=asyncio.Event(),
        execution_timeout_seconds=running["execution_timeout_seconds"],
    )


def _runtime(database):
    config = ClippingRuntimeConfig(
        enabled=True,
        derivation_handler_enabled=True,
        conversion_handler_enabled=True,
        binary=str(BINARY),
        timeout_seconds=30,
        derivation_timeout_seconds=30,
        conversion_timeout_seconds=30,
    )
    client = ClippingRuntimeClient(config)
    repository = ClippingRuntimeRepository(database)
    return config, client, repository


async def _create_and_claim_derivation(database, actor, asset, transcript, suffix):
    orchestration = ClippingOrchestrationRepository(database)
    created = await orchestration.create_project(
        actor,
        base.CreateProjectRequest(
            mediaAssetId=asset,
            transcriptId=transcript.transcriptId,
            name=f"Runtime project {suffix}",
            canvas=base.CanvasInput(aspectRatio="9:16", width=1080, height=1920),
        ),
        idempotency_key=f"runtime-create-{suffix}",
        maximum_ranges=500,
    )
    project_id = created["project"]["clipProjectId"]
    queued = await orchestration.request_derivation(
        actor,
        project_id,
        DeriveRequest(expectedRevision=1, includeRemappedTranscript=True),
        idempotency_key=f"runtime-derive-{suffix}",
    )
    leases = ProcessingJobLeaseRepository(database)
    claim = await leases.claim_next_job(
        worker_id=f"runtime-worker-{suffix}",
        supported_job_types=("project_derivation",),
        lease_seconds=90,
    )
    assert str(claim.job_id) == queued["jobId"]
    return orchestration, project_id, leases, claim


def test_real_runtime_derivation_and_conversion_finalize_atomically():
    base._prepare_database()
    actor, asset, transcript = base._seed()

    async def scenario():
        database = DurableDatabase(DATABASE_URL)
        orchestration = ClippingOrchestrationRepository(database)
        created = await orchestration.create_project(
            actor,
            base.CreateProjectRequest(
                mediaAssetId=asset,
                transcriptId=transcript.transcriptId,
                name="Runtime project",
                canvas=base.CanvasInput(
                    aspectRatio="9:16", width=1080, height=1920
                ),
            ),
            idempotency_key="runtime-create",
            maximum_ranges=500,
        )
        project_id = created["project"]["clipProjectId"]
        queued = await orchestration.request_derivation(
            actor,
            project_id,
            DeriveRequest(expectedRevision=1, includeRemappedTranscript=True),
            idempotency_key="runtime-derive",
        )
        leases = ProcessingJobLeaseRepository(database)
        claim = await leases.claim_next_job(
            worker_id="runtime-worker",
            supported_job_types=("project_derivation",),
            lease_seconds=90,
        )
        assert str(claim.job_id) == queued["jobId"]
        context = await _context(leases, claim)
        config, client, runtime_repository = _runtime(database)
        derivation = ProjectDerivationJobHandler(
            config=config, client=client, repository=runtime_repository
        )
        result = await derivation.execute(context, claim.input)
        assert result.finalized
        detail = await orchestration.get_detail(actor, project_id)
        assert detail["derived"]["edlStatus"] == "current"
        assert detail["derived"]["remappedTranscriptStatus"] == "current"

        conversion_job = await orchestration.request_conversion(
            actor,
            project_id,
            ConversionRequest(
                expectedRevision=1,
                targetProjectId="capinsta_runtime_target",
                includeCaptions=True,
            ),
            idempotency_key="runtime-convert",
        )
        conversion_claim = await leases.claim_next_job(
            worker_id="runtime-worker",
            supported_job_types=("project_conversion",),
            lease_seconds=90,
        )
        assert str(conversion_claim.job_id) == conversion_job["jobId"]
        conversion_context = await _context(leases, conversion_claim)
        conversion = ProjectConversionJobHandler(
            config=config, client=client, repository=runtime_repository
        )
        converted = await conversion.execute(
            conversion_context, conversion_claim.input
        )
        assert converted.finalized
        detail = await orchestration.get_detail(actor, project_id)
        assert detail["derived"]["conversionStatus"] == "current"
        status = await orchestration.status(actor, project_id)
        assert status["derivation"]["edl"] == "current"
        assert status["conversion"]["status"] == "succeeded"
        return project_id

    project_id = base._run(scenario())
    with base.psycopg.connect(DATABASE_URL) as connection:
        project = connection.execute(
            """SELECT latest_edl,latest_remapped_transcript,
            latest_conversion_result,latest_derivation_result_identity,
            latest_conversion_result_identity FROM clip_projects WHERE id=%s""",
            (project_id,),
        ).fetchone()
        assert all(project)
        jobs = connection.execute(
            """SELECT status,worker_id,claim_token,lease_expires_at,output
            FROM processing_jobs WHERE project_id=%s ORDER BY created_at""",
            (project_id,),
        ).fetchall()
        assert len(jobs) == 2
        assert all(row[0] == "succeeded" for row in jobs)
        assert all(row[1] is None and row[2] is None and row[3] is None for row in jobs)


def test_stale_project_revision_cannot_persist_runtime_result():
    base._prepare_database()
    actor, asset, transcript = base._seed()

    async def scenario():
        database = DurableDatabase(DATABASE_URL)
        _, project_id, leases, claim = await _create_and_claim_derivation(
            database, actor, asset, transcript, "stale"
        )
        context = await _context(leases, claim)
        with base.psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            connection.execute(
                """UPDATE clip_projects SET revision=2,
                project=jsonb_set(project,'{revision}','2'::jsonb)
                WHERE id=%s""",
                (project_id,),
            )
        config, client, runtime_repository = _runtime(database)
        handler = ProjectDerivationJobHandler(
            config=config, client=client, repository=runtime_repository
        )
        with pytest.raises(Exception) as error:
            await handler.execute(context, claim.input)
        assert getattr(error.value, "code", None) == "project_revision_mismatch"
        return project_id, str(claim.job_id)

    project_id, job_id = base._run(scenario())
    with base.psycopg.connect(DATABASE_URL) as connection:
        project = connection.execute(
            "SELECT latest_edl,latest_remapped_transcript FROM clip_projects WHERE id=%s",
            (project_id,),
        ).fetchone()
        job = connection.execute(
            "SELECT status FROM processing_jobs WHERE id=%s", (job_id,)
        ).fetchone()
        assert project == (None, None)
        assert job[0] == "running"


def test_finalization_failure_rolls_back_cache_and_job_success():
    base._prepare_database()
    actor, asset, transcript = base._seed()

    async def scenario():
        database = DurableDatabase(DATABASE_URL)
        _, project_id, leases, claim = await _create_and_claim_derivation(
            database, actor, asset, transcript, "rollback"
        )
        context = await _context(leases, claim)
        with base.psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            connection.execute(
                "DELETE FROM processing_job_attempts WHERE job_id=%s",
                (str(claim.job_id),),
            )
        config, client, runtime_repository = _runtime(database)
        handler = ProjectDerivationJobHandler(
            config=config, client=client, repository=runtime_repository
        )
        with pytest.raises(Exception) as error:
            await handler.execute(context, claim.input)
        assert getattr(error.value, "category", None) == "job_lease_lost"
        return project_id, str(claim.job_id)

    project_id, job_id = base._run(scenario())
    with base.psycopg.connect(DATABASE_URL) as connection:
        project = connection.execute(
            """SELECT latest_edl,latest_remapped_transcript,
            latest_derivation_result_identity FROM clip_projects WHERE id=%s""",
            (project_id,),
        ).fetchone()
        job = connection.execute(
            "SELECT status,output FROM processing_jobs WHERE id=%s", (job_id,)
        ).fetchone()
        assert project == (None, None, None)
        assert job == ("running", None)
