import array
import asyncio
import json
import os
import selectors
from pathlib import Path
from uuid import uuid4

import pytest

psycopg = pytest.importorskip("psycopg")

from server.clipping_jobs.config import ProcessingWorkerConfig
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_jobs.worker import ProcessingWorker
from server.clipping_persistence.database import DurableDatabase
from server.clipping_storage.local_storage import LocalMediaStorage
from server.media_variants.config import MediaVariantConfig
from server.media_variants.handlers import (
    AudioExtractionJobHandler,
    ProxyGenerationJobHandler,
    ThumbnailGenerationJobHandler,
    WaveformGenerationJobHandler,
)
from server.media_variants.planning import MediaVariantPlanningService
from server.media_variants.paths import variant_object_path
from server.media_variants.repository import MediaVariantRepository
from server.media_variants.ffmpeg import FFmpegCancelled

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


def _prepare_database(*, include_variant_migration=True):
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
        "0017_media_probe_handler.sql",
    ]
    if include_variant_migration:
        names.append("0018_media_variant_handlers.sql")
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


def test_variant_migration_preserves_legacy_ready_rows():
    _prepare_database(include_variant_migration=False)
    owner, asset, variant = uuid4(), uuid4(), uuid4()
    migration = (
        ROOT / "apps/web/migrations/0018_media_variant_handlers.sql"
    ).read_text(encoding="utf-8")
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id) VALUES (%s)", (owner,))
        connection.execute(
            """
            INSERT INTO media_assets(id,owner_user_id,display_name)
            VALUES (%s,%s,'legacy.mp4')
            """,
            (asset, owner),
        )
        connection.execute(
            """
            INSERT INTO media_variants(
              id,media_asset_id,variant_type,mime_type,size_bytes,
              storage_bucket,storage_path,status
            ) VALUES (
              %s,%s,'proxy','video/mp4',10,'media-variants',
              'legacy/object','ready'
            )
            """,
            (variant, asset),
        )
        connection.execute(migration)
        row = connection.execute(
            """
            SELECT status,source_media_revision,generation_spec_hash,revision
            FROM media_variants WHERE id=%s
            """,
            (variant,),
        ).fetchone()
    assert row == ("ready", None, None, 1)


def _insert_ready_source():
    owner, asset, probe_job = uuid4(), uuid4(), uuid4()
    probe_output = {
        "schemaVersion": 1,
        "mediaAssetId": str(asset),
        "mediaAssetRevision": 3,
        "mediaKind": "video",
        "durationMs": 1000,
        "container": {
            "formatName": "mov,mp4,m4a,3gp,3g2,mj2",
            "formatLongName": "QuickTime / MOV",
            "bitRate": 100000,
            "sizeBytes": 100,
        },
        "video": {
            "present": True,
            "codecName": "h264",
            "width": 320,
            "height": 180,
            "encodedWidth": 320,
            "encodedHeight": 180,
            "rotationDegrees": 0,
            "streamIndex": 0,
        },
        "audio": {
            "present": True,
            "codecName": "aac",
            "sampleRateHz": 48000,
            "channels": 2,
            "streamIndex": 1,
        },
        "streamCount": 2,
        "warnings": [],
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
              duration_ms,width,height,size_bytes,storage_bucket,storage_path,
              storage_object_revision,status,metadata,revision
            ) VALUES (
              %s,%s,'synthetic.mp4','video/mp4','video','uploaded',
              1000,320,180,100,'source-media',%s,1,'ready','{}'::jsonb,3
            )
            """,
            (asset, owner, f"{owner}/{asset}/source/v1.mp4"),
        )
        connection.execute(
            """
            INSERT INTO processing_jobs(
              id,owner_user_id,media_asset_id,job_type,status,progress,input,
              output,attempt_count,max_attempts,finished_at
            ) VALUES (
              %s,%s,%s,'media_probe','succeeded',100,%s,%s,1,3,now()
            )
            """,
            (
                probe_job,
                owner,
                asset,
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "jobType": "media_probe",
                        "mediaAssetId": str(asset),
                        "expectedMediaRevision": 2,
                        "storageObjectRevision": 1,
                        "requestedFields": None,
                        "metadata": {},
                    }
                ),
                json.dumps(probe_output),
            ),
        )
    return owner, asset


class FakeRunner:
    calls = 0

    async def run(self, source, *, arguments, progress_callback, **kwargs):
        del source, kwargs
        type(self).calls += 1
        output = Path(arguments[-1])
        if output.suffix == ".pcm":
            samples = array.array("h", [-1000, 1000] * 8000)
            output.write_bytes(samples.tobytes())
        else:
            output.write_bytes(b"verified-synthetic-artifact")
        await progress_callback(80)


class FakeVerifier:
    async def run(self, source, **kwargs):
        del kwargs
        suffix = Path(source.value).suffix
        if suffix == ".mp4":
            payload = {
                "format": {"duration": "1.000"},
                "streams": [
                    {
                        "codec_type": "video",
                        "codec_name": "h264",
                        "width": 320,
                        "height": 180,
                        "pix_fmt": "yuv420p",
                        "duration": "1.000",
                    },
                    {
                        "codec_type": "audio",
                        "codec_name": "aac",
                        "duration": "1.000",
                    },
                ],
            }
        elif suffix == ".wav":
            payload = {
                "format": {"duration": "1.000"},
                "streams": [
                    {
                        "codec_type": "audio",
                        "codec_name": "pcm_s16le",
                        "sample_rate": "16000",
                        "channels": 1,
                        "duration": "1.000",
                    }
                ],
            }
        else:
            payload = {
                "format": {},
                "streams": [
                    {
                        "codec_type": "video",
                        "codec_name": "mjpeg",
                        "width": 320,
                        "height": 180,
                    }
                ],
            }
        return json.dumps(payload).encode()


def _worker_config():
    return ProcessingWorkerConfig(
        enabled=True,
        worker_id="variant-postgres-test",
        poll_seconds=0.05,
        maximum_concurrency=1,
        shutdown_grace_seconds=5,
        lease_seconds=90,
        heartbeat_seconds=30,
        retry_base_seconds=1,
        retry_multiplier=1,
        retry_max_seconds=1,
        retry_jitter_percent=0,
        recovery_interval_seconds=30,
        recovery_batch_size=10,
    )


def test_planning_and_all_handlers_finalize_atomically(tmp_path):
    _prepare_database()
    owner, asset = _insert_ready_source()
    database = DurableDatabase(DATABASE_URL)
    planned = _run(MediaVariantPlanningService(database).plan(asset))
    assert len(planned) == 4
    assert len({item["variant"]["id"] for item in planned}) == 4
    replay = _run(MediaVariantPlanningService(database).plan(asset))
    assert {item["variant"]["id"] for item in replay} == {
        item["variant"]["id"] for item in planned
    }
    assert {item["job"]["id"] for item in replay} == {
        item["job"]["id"] for item in planned
    }

    storage = LocalMediaStorage(tmp_path / "storage")
    source = (
        tmp_path
        / "storage"
        / "source-media"
        / str(owner)
        / str(asset)
        / "source"
        / "v1.mp4"
    )
    source.parent.mkdir(parents=True)
    source.write_bytes(b"synthetic-source")
    # Simulate upload success followed by a crash before database finalization.
    proxy_plan = next(
        item for item in planned if item["variant"]["variant_type"] == "proxy"
    )
    crashed_output = tmp_path / "crashed-proxy.mp4"
    crashed_output.write_bytes(b"verified-synthetic-artifact")
    import hashlib

    crashed_checksum = hashlib.sha256(crashed_output.read_bytes()).hexdigest()
    proxy_path = variant_object_path(
        owner_user_id=owner,
        media_asset_id=asset,
        variant_type="proxy",
        source_revision=3,
        spec_hash=proxy_plan["variant"]["generation_spec_hash"],
    )
    _run(
        storage.upload_file(
            bucket="media-variants",
            path=proxy_path,
            local_path=crashed_output,
            content_type="video/mp4",
            maximum_bytes=1024 * 1024,
            checksum=crashed_checksum,
        )
    )
    config = MediaVariantConfig(
        enabled=True,
        temp_root=tmp_path / "work",
        maximum_temp_bytes=10 * 1024 * 1024,
        proxy_max_output_bytes=1024 * 1024,
        audio_max_output_bytes=1024 * 1024,
        thumbnail_max_output_bytes=1024 * 1024,
        waveform_max_output_bytes=1024 * 1024,
        storage_backend="local",
        local_storage_root=str(tmp_path / "storage"),
    )
    repository = MediaVariantRepository(database)
    FakeRunner.calls = 0
    registry = JobHandlerRegistry()
    for handler_type in (
        ProxyGenerationJobHandler,
        AudioExtractionJobHandler,
        ThumbnailGenerationJobHandler,
        WaveformGenerationJobHandler,
    ):
        registry.register(
            handler_type(
                config=config,
                storage=storage,
                repository=repository,
                runner=FakeRunner(),
                verifier_runner=FakeVerifier(),
            )
        )
    leases = ProcessingJobLeaseRepository(database)
    worker = ProcessingWorker(
        config=_worker_config(),
        repository=leases,
        registry=registry,
    )

    async def execute_all():
        for _ in range(4):
            claim = await leases.claim_next_job(
                worker_id="variant-postgres-test",
                supported_job_types=registry.supported_job_types,
                lease_seconds=90,
            )
            assert claim is not None
            await worker._execute_claim(claim)

    _run(execute_all())
    assert FakeRunner.calls == 4
    # A separately keyed duplicate request reuses the ready row/object rather
    # than executing FFmpeg again.
    duplicate_job = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        proxy_input = connection.execute(
            """
            SELECT input FROM processing_jobs
            WHERE media_asset_id=%s AND job_type='proxy_generation'
            """,
            (asset,),
        ).fetchone()[0]
        connection.execute(
            """
            INSERT INTO processing_jobs(
              id,owner_user_id,media_asset_id,job_type,status,priority,input,
              max_attempts,idempotency_key,execution_timeout_seconds
            ) VALUES (
              %s,%s,%s,'proxy_generation','queued',10,%s,3,
              'explicit-duplicate-ready-variant',1800
            )
            """,
            (duplicate_job, owner, asset, json.dumps(proxy_input)),
        )

    async def execute_duplicate():
        claim = await leases.claim_next_job(
            worker_id="variant-postgres-test",
            supported_job_types=("proxy_generation",),
            lease_seconds=90,
        )
        assert claim is not None and claim.job_id == duplicate_job
        await worker._execute_claim(claim)

    _run(execute_duplicate())
    assert FakeRunner.calls == 4
    with psycopg.connect(DATABASE_URL) as connection:
        variants = connection.execute(
            """
            SELECT variant_type,status,storage_path,result_identity,ready_at
            FROM media_variants WHERE media_asset_id=%s ORDER BY variant_type
            """,
            (asset,),
        ).fetchall()
        jobs = connection.execute(
            """
            SELECT job_type,status FROM processing_jobs
            WHERE media_asset_id=%s AND job_type <> 'media_probe'
            ORDER BY job_type
            """,
            (asset,),
        ).fetchall()
    assert {row[0] for row in variants} == {
        "proxy",
        "audio_extract",
        "thumbnail",
        "waveform",
    }
    assert all(
        row[1] == "ready" and row[2] and row[3] and row[4]
        for row in variants
    )
    assert len(jobs) == 5
    assert all(row[1] == "succeeded" for row in jobs)


def test_stale_source_revision_cannot_finalize(tmp_path):
    _prepare_database()
    _, asset = _insert_ready_source()
    database = DurableDatabase(DATABASE_URL)
    _run(MediaVariantPlanningService(database).plan(asset))
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "UPDATE media_assets SET revision=4 WHERE id=%s", (asset,)
        )
    leases = ProcessingJobLeaseRepository(database)
    claim = _run(
        leases.claim_next_job(
            worker_id="stale-test",
            supported_job_types=("proxy_generation",),
            lease_seconds=90,
        )
    )
    assert claim is not None
    storage = LocalMediaStorage(tmp_path / "storage")
    config = MediaVariantConfig(
        enabled=True,
        temp_root=tmp_path / "work",
        storage_backend="local",
        local_storage_root=str(tmp_path / "storage"),
    )
    registry = JobHandlerRegistry()
    registry.register(
        ProxyGenerationJobHandler(
            config=config,
            storage=storage,
            repository=MediaVariantRepository(database),
            runner=FakeRunner(),
            verifier_runner=FakeVerifier(),
        )
    )
    worker = ProcessingWorker(
        config=_worker_config(), repository=leases, registry=registry
    )
    _run(worker._execute_claim(claim))
    with psycopg.connect(DATABASE_URL) as connection:
        status = connection.execute(
            "SELECT status FROM processing_jobs WHERE id=%s", (claim.job_id,)
        ).fetchone()[0]
        ready = connection.execute(
            """
            SELECT count(*) FROM media_variants
            WHERE media_asset_id=%s AND status='ready'
            """,
            (asset,),
        ).fetchone()[0]
    assert status == "failed"
    assert ready == 0


def test_variant_rls_is_owner_scoped_and_browser_read_only():
    _prepare_database()
    owner_a, asset_a = _insert_ready_source()
    owner_b, asset_b = _insert_ready_source()
    database = DurableDatabase(DATABASE_URL)
    _run(MediaVariantPlanningService(database).plan(asset_a))
    _run(MediaVariantPlanningService(database).plan(asset_b))
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,false)",
            (str(owner_a),),
        )
        connection.execute("SET ROLE authenticated")
        rows = connection.execute(
            "SELECT id,media_asset_id,status FROM media_variants"
        ).fetchall()
        assert rows and {row[1] for row in rows} == {asset_a}
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "UPDATE media_variants SET status='ready' WHERE id=%s",
                (rows[0][0],),
            )
        connection.execute("ROLLBACK")
        connection.execute("RESET ROLE")
        connection.execute("SET ROLE anon")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("SELECT id FROM media_variants")


def test_concurrent_planning_converges_on_one_variant_and_job_identity():
    _prepare_database()
    _, asset = _insert_ready_source()

    async def race():
        return await asyncio.gather(
            MediaVariantPlanningService(
                DurableDatabase(DATABASE_URL)
            ).plan(asset),
            MediaVariantPlanningService(
                DurableDatabase(DATABASE_URL)
            ).plan(asset),
        )

    first, second = _run(race())
    assert {item["variant"]["id"] for item in first} == {
        item["variant"]["id"] for item in second
    }
    assert {item["job"]["id"] for item in first} == {
        item["job"]["id"] for item in second
    }
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute(
            "SELECT count(*) FROM media_variants WHERE media_asset_id=%s",
            (asset,),
        ).fetchone()[0] == 4
        assert connection.execute(
            """
            SELECT count(*) FROM processing_jobs
            WHERE media_asset_id=%s AND job_type <> 'media_probe'
            """,
            (asset,),
        ).fetchone()[0] == 4


def test_running_variant_cancellation_releases_row_and_cleans_temp(tmp_path):
    _prepare_database()
    owner, asset = _insert_ready_source()
    database = DurableDatabase(DATABASE_URL)
    planned = _run(MediaVariantPlanningService(database).plan(asset))
    proxy = next(
        item for item in planned if item["variant"]["variant_type"] == "proxy"
    )
    storage = LocalMediaStorage(tmp_path / "storage")
    source = (
        tmp_path
        / "storage"
        / "source-media"
        / str(owner)
        / str(asset)
        / "source"
        / "v1.mp4"
    )
    source.parent.mkdir(parents=True)
    source.write_bytes(b"synthetic-source")

    class BlockingRunner:
        async def run(self, *args, **kwargs):
            del args
            while not await kwargs["cancellation_check"]():
                await asyncio.sleep(0.01)
            raise FFmpegCancelled

    config = MediaVariantConfig(
        enabled=True,
        temp_root=tmp_path / "work",
        maximum_temp_bytes=10 * 1024 * 1024,
        storage_backend="local",
        local_storage_root=str(tmp_path / "storage"),
    )
    registry = JobHandlerRegistry()
    registry.register(
        ProxyGenerationJobHandler(
            config=config,
            storage=storage,
            repository=MediaVariantRepository(database),
            runner=BlockingRunner(),
            verifier_runner=FakeVerifier(),
        )
    )
    leases = ProcessingJobLeaseRepository(database)
    class Events:
        def __init__(self):
            self.values = []

        def emit(self, event, **fields):
            self.values.append((event, fields))

    events = Events()
    worker = ProcessingWorker(
        config=_worker_config(),
        repository=leases,
        registry=registry,
        events=events,
    )

    async def cancel_running():
        claim = await leases.claim_next_job(
            worker_id="variant-postgres-test",
            supported_job_types=("proxy_generation",),
            lease_seconds=90,
        )
        assert claim is not None
        task = asyncio.create_task(worker._execute_claim(claim))
        for _ in range(100):
            with psycopg.connect(DATABASE_URL) as connection:
                variant_status = connection.execute(
                    "SELECT status FROM media_variants WHERE id=%s",
                    (proxy["variant"]["id"],),
                ).fetchone()[0]
            if variant_status == "processing":
                break
            await asyncio.sleep(0.01)
        assert variant_status == "processing"
        await leases.request_cancellation(
            claim.job_id, reason="variant cancellation test"
        )
        await asyncio.wait_for(task, timeout=5)
        return await leases.get_job(claim.job_id)

    cancelled = _run(cancel_running())
    assert cancelled["status"] == "cancelled", events.values
    with psycopg.connect(DATABASE_URL) as connection:
        variant_status = connection.execute(
            "SELECT status FROM media_variants WHERE id=%s",
            (proxy["variant"]["id"],),
        ).fetchone()[0]
    assert variant_status == "queued"
    assert not config.temp_root.exists() or not any(
        config.temp_root.rglob("*")
    )
