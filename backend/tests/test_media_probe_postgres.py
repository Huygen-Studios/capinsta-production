import asyncio
import json
import os
import selectors
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest

psycopg = pytest.importorskip("psycopg")
from psycopg.rows import dict_row

from server.clipping_jobs.config import ProcessingWorkerConfig
from server.clipping_jobs.errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from server.clipping_jobs.models import JobExecutionContext
from server.clipping_jobs.policies import RetryBackoff
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_jobs.worker import ProcessingWorker
from server.clipping_persistence.database import DurableDatabase
from server.clipping_storage.local_storage import LocalMediaStorage
from server.clipping_storage.models import ProbeSource, StorageObjectMetadata
from server.media_probe.config import MediaProbeConfig
from server.media_probe.contracts import (
    MediaProbeJobInputV1,
    MediaProbeResultV1,
)
from server.media_probe.ffprobe import MediaProbeCancelled
from server.media_probe.handler import MediaProbeJobHandler
from server.media_probe.normalization import MediaProbeNormalizer
from server.media_probe.repository import MediaProbeRepository

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


def _prepare_database(*, include_probe_migration=True):
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
        "0016_processing_job_leases.sql",
    ]
    if include_probe_migration:
        names.append("0017_media_probe_handler.sql")
    migrations = [
        (
            ROOT / f"apps/web/migrations/{name}"
        ).read_text(encoding="utf-8")
        for name in names
    ]
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        name = connection.execute("SELECT current_database()").fetchone()[0]
        if "test" not in name.lower():
            raise RuntimeError("Refusing to reset a non-test database")
        connection.execute(bootstrap)
        for migration in migrations:
            connection.execute(migration)


def test_probe_migration_backfills_revision_guards_without_sources():
    _prepare_database(include_probe_migration=False)
    owner, asset, job = uuid4(), uuid4(), uuid4()
    old_input = {
        "schemaVersion": 1,
        "jobType": "media_probe",
        "mediaAssetId": str(asset),
        "metadata": {},
    }
    migration = (
        ROOT / "apps/web/migrations/0017_media_probe_handler.sql"
    ).read_text(encoding="utf-8")
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "INSERT INTO auth.users(id,email) VALUES (%s,'legacy@example.invalid')",
            (owner,),
        )
        connection.execute(
            """
            INSERT INTO media_assets(
              id,owner_user_id,display_name,storage_bucket,storage_path,
              status,revision
            ) VALUES (
              %s,%s,'legacy.mp4','source-media',%s,'ready_for_probe',8
            )
            """,
            (asset, owner, f"{owner}/{asset}/source/v7.mp4"),
        )
        connection.execute(
            """
            INSERT INTO processing_jobs(
              id,owner_user_id,media_asset_id,job_type,status,input
            ) VALUES (%s,%s,%s,'media_probe','queued',%s)
            """,
            (job, owner, asset, json.dumps(old_input)),
        )
        connection.execute(migration)
        storage_revision = connection.execute(
            "SELECT storage_object_revision FROM media_assets WHERE id=%s",
            (asset,),
        ).fetchone()[0]
        upgraded = connection.execute(
            "SELECT input FROM processing_jobs WHERE id=%s", (job,)
        ).fetchone()[0]
    assert storage_revision == 7
    assert upgraded["expectedMediaRevision"] == 8
    assert upgraded["storageObjectRevision"] == 7
    assert upgraded["requestedFields"] is None
    serialized = json.dumps(upgraded)
    assert "source/v7" not in serialized
    assert "http" not in serialized.lower()


def _insert_probe_job(*, path: str, mime_type="video/mp4"):
    owner, asset, job = uuid4(), uuid4(), uuid4()
    payload = {
        "schemaVersion": 1,
        "jobType": "media_probe",
        "mediaAssetId": str(asset),
        "expectedMediaRevision": 2,
        "storageObjectRevision": 1,
        "requestedFields": None,
        "metadata": {},
    }
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "INSERT INTO auth.users(id,email) VALUES (%s,%s)",
            (owner, f"{owner}@example.invalid"),
        )
        connection.execute(
            """
            INSERT INTO media_assets(
              id,owner_user_id,display_name,mime_type,media_kind,source_type,
              size_bytes,storage_bucket,storage_path,storage_object_revision,
              status,metadata,revision
            ) VALUES (
              %s,%s,'synthetic.mp4',%s,'video','uploaded',
              20,'source-media',%s,1,'ready_for_probe',
              '{"preserved":"yes"}'::jsonb,2
            )
            """,
            (asset, owner, mime_type, path),
        )
        connection.execute(
            """
            INSERT INTO processing_jobs(
              id,owner_user_id,media_asset_id,job_type,status,input,
              max_attempts,execution_timeout_seconds
            ) VALUES (%s,%s,%s,'media_probe','queued',%s,3,30)
            """,
            (job, owner, asset, json.dumps(payload)),
        )
    return owner, asset, job, payload


def _probe_json():
    return {
        "format": {
            "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
            "format_long_name": "QuickTime / MOV",
            "duration": "1.2345",
            "size": "20",
            "bit_rate": "100000",
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 160,
                "height": 90,
                "coded_width": 160,
                "coded_height": 90,
                "pix_fmt": "yuv420p",
                "avg_frame_rate": "30000/1001",
                "r_frame_rate": "30/1",
                "duration": "1.2345",
                "disposition": {"default": 1, "attached_pic": 0},
            },
            {
                "index": 1,
                "codec_type": "audio",
                "codec_name": "aac",
                "sample_rate": "48000",
                "channels": 2,
                "channel_layout": "stereo",
                "duration": "1.2345",
                "disposition": {"default": 1},
            },
        ],
    }


class _StaticRunner:
    async def run(self, source, **kwargs):
        return json.dumps(_probe_json()).encode()


class _BlockingRunner:
    async def run(
        self,
        source,
        *,
        cancellation_check,
        cancellation_event,
        **kwargs,
    ):
        for _ in range(100):
            if cancellation_event.is_set() or await cancellation_check():
                raise MediaProbeCancelled
            await asyncio.sleep(0.01)
        return json.dumps(_probe_json()).encode()


class _EphemeralStorage:
    signed_url = (
        "https://private.example/source/object?"
        "token=super-secret-signature"
    )

    async def inspect_object(self, *, bucket, path):
        return StorageObjectMetadata(
            bucket=bucket,
            path=path,
            size_bytes=20,
            mime_type="video/mp4",
        )

    @asynccontextmanager
    async def open_probe_source(self, *, bucket, path, expires_in):
        yield ProbeSource(
            kind="ephemeral_url",
            value=self.signed_url,
            expires_at=datetime.now(timezone.utc)
            + timedelta(seconds=expires_in),
            redacted_display="https://private.example/[private-object]",
        )


def _config():
    return MediaProbeConfig(
        enabled=True,
        timeout_seconds=10,
        terminate_grace_seconds=1,
        signed_url_ttl_seconds=30,
        signed_url_safety_seconds=2,
        storage_backend="local",
        local_storage_root=str(ROOT),
    )


def _worker_config():
    return ProcessingWorkerConfig(
        enabled=True,
        worker_id="probe-worker",
        poll_seconds=0.01,
        maximum_concurrency=1,
        shutdown_grace_seconds=2,
        lease_seconds=5,
        heartbeat_seconds=1,
        retry_jitter_percent=0,
    )


def _handler(database, storage, runner, repository=None):
    config = _config()
    return MediaProbeJobHandler(
        config=config,
        storage=storage,
        repository=repository or MediaProbeRepository(database),
        runner=runner,
        normalizer=MediaProbeNormalizer(
            maximum_duration_ms=config.maximum_duration_ms,
            maximum_fps=config.maximum_fps,
        ),
    )


def _read_rows(asset_id, job_id):
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        asset = connection.execute(
            "SELECT * FROM media_assets WHERE id=%s", (asset_id,)
        ).fetchone()
        job = connection.execute(
            "SELECT * FROM processing_jobs WHERE id=%s", (job_id,)
        ).fetchone()
        attempt = connection.execute(
            "SELECT * FROM processing_job_attempts WHERE job_id=%s",
            (job_id,),
        ).fetchone()
    return asset, job, attempt


def test_postgres_end_to_end_worker_success(tmp_path):
    _prepare_database()
    path = f"{uuid4()}/{uuid4()}/source/v1.mp4"
    local = LocalMediaStorage(tmp_path)
    target = local._path("source-media", path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"synthetic probe object")
    _, asset_id, job_id, _ = _insert_probe_job(path=path)
    database = DurableDatabase(DATABASE_URL)
    lease_repository = ProcessingJobLeaseRepository(database)
    registry = JobHandlerRegistry()
    registry.register(_handler(database, local, _StaticRunner()))
    worker = ProcessingWorker(
        config=_worker_config(),
        repository=lease_repository,
        registry=registry,
    )

    async def execute():
        claim = await lease_repository.claim_next_job(
            worker_id="probe-worker",
            supported_job_types=("media_probe",),
            lease_seconds=5,
        )
        assert claim is not None
        await worker._execute_claim(claim)

    _run(execute())
    asset, job, attempt = _read_rows(asset_id, job_id)
    assert asset["status"] == "ready"
    assert asset["media_kind"] == "video"
    assert (
        asset["duration_ms"],
        asset["width"],
        asset["height"],
        asset["fps_numerator"],
        asset["fps_denominator"],
    ) == (1235, 160, 90, 30000, 1001)
    assert asset["metadata"]["preserved"] == "yes"
    assert asset["metadata"]["probe"]["audioCodec"] == "aac"
    assert asset["revision"] == 3
    assert job["status"] == "succeeded"
    assert job["progress"] == 100
    assert job["output"]["durationMs"] == asset["duration_ms"]
    assert job["worker_id"] is None and job["claim_token"] is None
    assert attempt["status"] == "succeeded"
    serialized = json.dumps(
        {
            "asset": asset["metadata"],
            "job": job["output"],
            "attempt": attempt["output_summary"],
        },
        default=str,
    )
    assert "http" not in serialized.lower()
    assert "token" not in serialized.lower()


def test_ephemeral_signed_source_is_absent_from_all_durable_rows():
    _prepare_database()
    _, asset_id, job_id, _ = _insert_probe_job(
        path=f"{uuid4()}/{uuid4()}/source/v1.mp4"
    )
    database = DurableDatabase(DATABASE_URL)
    leases = ProcessingJobLeaseRepository(database)
    registry = JobHandlerRegistry()
    registry.register(
        _handler(database, _EphemeralStorage(), _StaticRunner())
    )
    worker = ProcessingWorker(
        config=_worker_config(), repository=leases, registry=registry
    )

    async def execute():
        claim = await leases.claim_next_job(
            worker_id="probe-worker",
            supported_job_types=("media_probe",),
            lease_seconds=5,
        )
        await worker._execute_claim(claim)

    _run(execute())
    asset, job, attempt = _read_rows(asset_id, job_id)
    serialized = json.dumps(
        {
            "asset": asset,
            "job": job,
            "attempt": attempt,
        },
        default=str,
    )
    assert "super-secret-signature" not in serialized
    assert "private.example" not in serialized
    assert "https://" not in serialized


class _RollbackRepository(MediaProbeRepository):
    async def _before_job_completion(self, connection, output):
        raise RuntimeError("simulated crash before job completion")


def _claim_context(database, job_id):
    lease_repository = ProcessingJobLeaseRepository(database)

    async def create():
        claim = await lease_repository.claim_next_job(
            worker_id="probe-worker",
            supported_job_types=("media_probe",),
            lease_seconds=5,
        )
        assert claim and claim.job_id == job_id
        await lease_repository.start_running(
            claim.job_id,
            worker_id=claim.worker_id,
            claim_token=claim.claim_token,
            lease_seconds=5,
            expected_revision=claim.revision,
        )

        async def heartbeat(**kwargs):
            return await lease_repository.heartbeat_job(
                claim.job_id,
                worker_id=claim.worker_id,
                claim_token=claim.claim_token,
                lease_extension_seconds=5,
                **kwargs,
            )

        async def cancelled():
            return await lease_repository.cancellation_requested(
                claim.job_id,
                worker_id=claim.worker_id,
                claim_token=claim.claim_token,
            )

        return JobExecutionContext(
            job_id=claim.job_id,
            attempt_number=claim.attempt_number,
            worker_id=claim.worker_id,
            claim_token=claim.claim_token,
            heartbeat_callback=heartbeat,
            cancellation_callback=cancelled,
            shutdown_event=asyncio.Event(),
            maximum_attempts=claim.maximum_attempts,
            execution_timeout_seconds=30,
        )

    return _run(create())


def _normalized(payload):
    job_input = MediaProbeJobInputV1.model_validate(payload)
    return MediaProbeNormalizer(
        maximum_duration_ms=86_400_000, maximum_fps=240
    ).normalize(
        _probe_json(),
        job_input=job_input,
        declared_mime="video/mp4",
        storage_mime="video/mp4",
        display_name="synthetic.mp4",
    )


def test_atomic_finalizer_rolls_back_asset_and_job_together():
    _prepare_database()
    _, asset_id, job_id, payload = _insert_probe_job(
        path=f"{uuid4()}/{uuid4()}/source/v1.mp4"
    )
    database = DurableDatabase(DATABASE_URL)
    context = _claim_context(database, job_id)
    repository = _RollbackRepository(database)
    job_input = MediaProbeJobInputV1.model_validate(payload)
    _run(repository.begin_probe(context, job_input))
    with pytest.raises(RuntimeError, match="simulated crash"):
        _run(
            repository.finalize_success(
                context, job_input, _normalized(payload)
            )
        )
    asset, job, attempt = _read_rows(asset_id, job_id)
    assert asset["status"] == "probing"
    assert asset["revision"] == 2
    assert asset["probe_result_identity"] is None
    assert job["status"] == "running"
    assert job["output"] is None
    assert attempt["status"] == "running"


def test_stale_replacement_cannot_overwrite_new_object():
    _prepare_database()
    _, asset_id, job_id, payload = _insert_probe_job(
        path=f"{uuid4()}/{uuid4()}/source/v1.mp4"
    )
    database = DurableDatabase(DATABASE_URL)
    context = _claim_context(database, job_id)
    repository = MediaProbeRepository(database)
    job_input = MediaProbeJobInputV1.model_validate(payload)
    _run(repository.begin_probe(context, job_input))
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """
            UPDATE media_assets SET revision=3,storage_object_revision=2,
              storage_path=%s,status='ready_for_probe',
              metadata='{"replacement":"safe"}'::jsonb
            WHERE id=%s
            """,
            (f"{uuid4()}/{asset_id}/source/v2.mp4", asset_id),
        )
    with pytest.raises(ProcessingJobFailure) as error:
        _run(
            repository.finalize_success(
                context, job_input, _normalized(payload)
            )
        )
    assert error.value.code == "media_asset_revision_mismatch"
    asset, job, _ = _read_rows(asset_id, job_id)
    assert asset["revision"] == 3
    assert asset["metadata"] == {"replacement": "safe"}
    assert job["status"] == "running"


def test_lease_recovery_rejects_old_probe_and_new_attempt_completes():
    _prepare_database()
    _, asset_id, job_id, payload = _insert_probe_job(
        path=f"{uuid4()}/{uuid4()}/source/v1.mp4"
    )
    database = DurableDatabase(DATABASE_URL)
    leases = ProcessingJobLeaseRepository(database)
    old_context = _claim_context(database, job_id)
    probe_repository = MediaProbeRepository(database)
    job_input = MediaProbeJobInputV1.model_validate(payload)
    _run(probe_repository.begin_probe(old_context, job_input))
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """
            UPDATE processing_jobs SET lease_expires_at=now()-interval '1 second'
            WHERE id=%s
            """,
            (job_id,),
        )

    async def recover_and_reclaim():
        summary = await leases.sweep_recovery(
            batch_size=10,
            backoff=RetryBackoff(
                base_seconds=0,
                multiplier=1,
                maximum_seconds=0,
                jitter_percent=0,
            ),
        )
        assert summary["leasesRecovered"] == 1
        assert summary["retriesPromoted"] == 1
        claim = await leases.claim_next_job(
            worker_id="probe-worker-b",
            supported_job_types=("media_probe",),
            lease_seconds=5,
        )
        await leases.start_running(
            claim.job_id,
            worker_id=claim.worker_id,
            claim_token=claim.claim_token,
            lease_seconds=5,
            expected_revision=claim.revision,
        )

        async def heartbeat(**kwargs):
            return {}

        async def cancelled():
            return False

        return JobExecutionContext(
            job_id=claim.job_id,
            attempt_number=claim.attempt_number,
            worker_id=claim.worker_id,
            claim_token=claim.claim_token,
            heartbeat_callback=heartbeat,
            cancellation_callback=cancelled,
            shutdown_event=asyncio.Event(),
            maximum_attempts=claim.maximum_attempts,
            execution_timeout_seconds=30,
        )

    new_context = _run(recover_and_reclaim())
    with pytest.raises(JobOrchestrationError) as error:
        _run(
            probe_repository.finalize_success(
                old_context, job_input, _normalized(payload)
            )
        )
    assert error.value.category in {
        "worker_mismatch",
        "claim_token_mismatch",
        "job_lease_lost",
        "job_lease_expired",
    }
    _run(
        probe_repository.finalize_success(
            new_context, job_input, _normalized(payload)
        )
    )
    asset, job, _ = _read_rows(asset_id, job_id)
    assert asset["status"] == "ready"
    assert job["status"] == "succeeded"
    assert job["attempt_count"] == 2


def test_active_cancellation_does_not_make_asset_ready(tmp_path):
    _prepare_database()
    path = f"{uuid4()}/{uuid4()}/source/v1.mp4"
    local = LocalMediaStorage(tmp_path)
    target = local._path("source-media", path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"synthetic probe object")
    _, asset_id, job_id, _ = _insert_probe_job(path=path)
    database = DurableDatabase(DATABASE_URL)
    leases = ProcessingJobLeaseRepository(database)
    registry = JobHandlerRegistry()
    registry.register(_handler(database, local, _BlockingRunner()))
    worker = ProcessingWorker(
        config=_worker_config(), repository=leases, registry=registry
    )

    async def cancel_during_probe():
        claim = await leases.claim_next_job(
            worker_id="probe-worker",
            supported_job_types=("media_probe",),
            lease_seconds=5,
        )
        task = asyncio.create_task(worker._execute_claim(claim))
        for _ in range(100):
            with psycopg.connect(DATABASE_URL) as connection:
                status = connection.execute(
                    "SELECT status FROM media_assets WHERE id=%s",
                    (asset_id,),
                ).fetchone()[0]
            if status == "probing":
                break
            await asyncio.sleep(0.01)
        await leases.request_cancellation(job_id, reason="user_cancelled")
        await task

    _run(cancel_during_probe())
    asset, job, attempt = _read_rows(asset_id, job_id)
    assert asset["status"] == "ready_for_probe"
    assert asset["duration_ms"] is None
    assert job["status"] == "cancelled"
    assert job["lease_expires_at"] is None
    assert attempt["status"] == "cancelled"


def test_permanent_failure_sets_probe_failed_atomically(tmp_path):
    _prepare_database()
    path = f"{uuid4()}/{uuid4()}/source/v1.mp4"
    local = LocalMediaStorage(tmp_path)
    target = local._path("source-media", path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"synthetic probe object")
    _, asset_id, job_id, _ = _insert_probe_job(path=path)
    database = DurableDatabase(DATABASE_URL)

    class InvalidRunner:
        async def run(self, source, **kwargs):
            raise ProcessingJobFailure(
                "ffprobe_no_supported_streams",
                "Media has no supported streams",
                retryable=False,
            )

    leases = ProcessingJobLeaseRepository(database)
    registry = JobHandlerRegistry()
    registry.register(_handler(database, local, InvalidRunner()))
    worker = ProcessingWorker(
        config=_worker_config(), repository=leases, registry=registry
    )

    async def execute():
        claim = await leases.claim_next_job(
            worker_id="probe-worker",
            supported_job_types=("media_probe",),
            lease_seconds=5,
        )
        await worker._execute_claim(claim)

    _run(execute())
    asset, job, attempt = _read_rows(asset_id, job_id)
    assert asset["status"] == "probe_failed"
    assert asset["metadata"]["preserved"] == "yes"
    assert (
        asset["metadata"]["probeFailure"]["code"]
        == "ffprobe_no_supported_streams"
    )
    assert job["status"] == "failed"
    assert job["failure_code"] == "ffprobe_no_supported_streams"
    assert attempt["status"] == "failed"


def test_authenticated_role_cannot_write_probe_fields():
    _prepare_database()
    owner, asset_id, _, _ = _insert_probe_job(
        path=f"{uuid4()}/{uuid4()}/source/v1.mp4"
    )
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,false)",
            (str(owner),),
        )
        row = connection.execute(
            "SELECT duration_ms,status FROM media_assets WHERE id=%s",
            (asset_id,),
        ).fetchone()
        assert row == (None, "ready_for_probe")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                """
                UPDATE media_assets SET duration_ms=1,status='ready',
                  metadata='{"probe":{"forged":true}}'::jsonb
                WHERE id=%s
                """,
                (asset_id,),
            )
        connection.rollback()
        connection.execute("SET ROLE anon")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "SELECT count(*) FROM media_assets"
            )
