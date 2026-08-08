from __future__ import annotations

import asyncio
import hashlib
import json
from uuid import UUID

import pytest

psycopg = pytest.importorskip("psycopg")

from server.clipping_exports.config import ClippingExportConfig
from server.clipping_exports.contracts import (
    ClippingExportJobInputV1,
    ClippingExportRequestV1,
    PreviewRequestV1,
)
from server.clipping_exports.errors import ClippingExportError
from server.clipping_exports.handler import export_object_path
from server.clipping_exports.repository import ClippingExportRepository
from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext
from server.clipping_jobs.policies import RetryBackoff
from server.clipping_jobs.repository import ProcessingJobLeaseRepository
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError
from server.clipping_storage.errors import StorageError
from server.clipping_storage.local_storage import LocalMediaStorage

from test_clipping_orchestration_postgres import (
    DATABASE_URL,
    ROOT,
    _create,
    _prepare_database,
    _run,
    _seed,
)

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="Disposable PostgreSQL 17 test URL required"
)


def _replace(value, old, new):
    if isinstance(value, dict):
        return {key: _replace(item, old, new) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace(item, old, new) for item in value]
    return new if value == old else value


def _current_project():
    actor, asset, transcript = _seed()
    from server.clipping_orchestration.repository import ClippingOrchestrationRepository

    created = _create(
        ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL)),
        actor,
        asset,
        transcript,
    )
    project_id = created["project"]["clipProjectId"]
    fixture = json.loads(
        (
            ROOT / "contracts/fixtures/capinsta-project-conversion-v1/valid/"
            "project-with-remapped-captions.json"
        ).read_text("utf-8")
    )
    edl = _replace(fixture["input"]["editDecisionList"], "media_001", str(asset))
    edl["clipProjectId"] = project_id
    edl["projectRevision"] = 1
    remapped = _replace(fixture["input"]["remappedTranscript"], "media_001", str(asset))
    remapped["clipProjectId"] = project_id
    remapped["projectRevision"] = 1
    conversion = _replace(fixture["result"], "media_001", str(asset))
    conversion["sourceClipProjectId"] = project_id
    conversion["sourceClipProjectRevision"] = 1
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """UPDATE media_assets SET metadata=%s WHERE id=%s""",
            (json.dumps({"probe": {"audioCodec": None}}), asset),
        )
        connection.execute(
            """UPDATE clip_projects SET latest_edl=%s,
            latest_edl_revision=1,latest_remapped_transcript=%s,
            latest_remapped_transcript_revision=1,
            latest_derivation_transcript_revision=1,
            latest_derivation_result_identity=%s,
            latest_conversion_result=%s,latest_conversion_revision=1,
            latest_conversion_result_identity=%s WHERE id=%s""",
            (
                json.dumps(edl),
                json.dumps(remapped),
                "a" * 64,
                json.dumps(conversion),
                "b" * 64,
                project_id,
            ),
        )
    return actor, project_id


def _repository():
    return ClippingExportRepository(
        DurableDatabase(DATABASE_URL),
        ClippingExportConfig(
            preview_api_enabled=True,
            export_api_enabled=True,
            maximum_output_bytes=1024,
        ),
    )


async def _create_export(repository, actor, project_id, key):
    return await repository.create(
        actor,
        project_id,
        ClippingExportRequestV1(expectedProjectRevision=1),
        idempotency_key=key,
    )


async def _claim_running(database, worker_id="export-worker"):
    leases = ProcessingJobLeaseRepository(database)
    claim = await leases.claim_next_job(
        worker_id=worker_id,
        supported_job_types=("clip_export",),
        lease_seconds=90,
    )
    assert claim is not None
    running = await leases.start_running(
        claim.job_id,
        worker_id=claim.worker_id,
        claim_token=claim.claim_token,
        lease_seconds=90,
        current_stage="starting",
        expected_revision=claim.revision,
    )

    async def heartbeat(**kwargs):
        return await leases.heartbeat_job(
            claim.job_id,
            worker_id=claim.worker_id,
            claim_token=claim.claim_token,
            lease_extension_seconds=90,
            **kwargs,
        )

    async def not_cancelled():
        return False

    context = JobExecutionContext(
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
    return leases, claim, context, ClippingExportJobInputV1.model_validate(claim.input)


def _successful_output():
    return {
        "storageBucket": "media-exports",
        "storagePath": "owner/project/1/spec/output.mp4",
        "mimeType": "video/mp4",
        "sizeBytes": 100,
        "durationMs": 19_000,
        "width": 1080,
        "height": 1920,
        "checksum": "c" * 64,
    }


def test_migration_has_required_live_structure_and_browser_grants():
    _prepare_database()
    with psycopg.connect(DATABASE_URL) as connection:
        table = connection.execute(
            """SELECT relrowsecurity FROM pg_class
            WHERE oid='clipping_exports'::regclass"""
        ).fetchone()
        assert table == (True,)
        indexes = {
            row[0]
            for row in connection.execute(
                """SELECT indexname FROM pg_indexes
                WHERE tablename='clipping_exports'"""
            )
        }
        assert {
            "clipping_exports_pkey",
            "clipping_exports_processing_job_id_key",
            "clipping_exports_active_identity_key",
            "clipping_exports_owner_created_idx",
            "clipping_exports_project_created_idx",
        } <= indexes
        constraints = {
            row[0]
            for row in connection.execute(
                """SELECT conname FROM pg_constraint
                WHERE conrelid='clipping_exports'::regclass"""
            )
        }
        assert {
            "clipping_exports_revision_check",
            "clipping_exports_identity_check",
            "clipping_exports_status_check",
            "clipping_exports_output_check",
        } <= constraints
        assert connection.execute(
            """SELECT count(*) FROM pg_trigger
            WHERE tgrelid='clipping_exports'::regclass
            AND tgname='clipping_exports_identity_trigger' AND NOT tgisinternal"""
        ).fetchone() == (1,)
        writable = connection.execute(
            """SELECT has_table_privilege('authenticated','clipping_exports','INSERT'),
            has_table_privilege('authenticated','clipping_exports','UPDATE'),
            has_table_privilege('authenticated','clipping_exports','DELETE')"""
        ).fetchone()
        assert writable == (False, False, False)


def test_preview_and_concurrent_identity_reuse_are_revision_bound():
    _prepare_database()
    actor, project_id = _current_project()
    repository = _repository()
    preview = _run(
        repository.preview(
            actor,
            project_id,
            PreviewRequestV1(expectedRevision=1),
            idempotency_key="preview-one",
        )
    )
    encoded = json.dumps(preview)
    assert preview["manifest"]["clipProjectRevision"] == 1
    assert "storagePath" not in encoded
    assert "signedUrl" not in encoded

    async def concurrent_create():
        return await asyncio.gather(
            _create_export(repository, actor, project_id, "export-one"),
            _create_export(repository, actor, project_id, "export-two"),
        )

    first, second = _run(concurrent_create())
    assert first["exportId"] == second["exportId"]
    replay = _run(_create_export(repository, actor, project_id, "export-one"))
    assert replay["exportId"] == first["exportId"]
    assert replay["replayed"] is True
    with pytest.raises(ClippingExportError, match="different request") as conflict:
        _run(
            repository.create(
                actor,
                project_id,
                ClippingExportRequestV1(expectedProjectRevision=2),
                idempotency_key="export-one",
            )
        )
    assert conflict.value.code == "idempotency_conflict"
    with pytest.raises(ClippingExportError) as stale:
        _run(
            repository.create(
                actor,
                project_id,
                ClippingExportRequestV1(expectedProjectRevision=2),
                idempotency_key="export-stale",
            )
        )
    assert stale.value.code == "project_revision_mismatch"
    with psycopg.connect(DATABASE_URL) as connection:
        assert (
            connection.execute("SELECT count(*) FROM clipping_exports").fetchone()[0]
            == 1
        )
        assert (
            connection.execute(
                "SELECT count(*) FROM processing_jobs WHERE job_type='clip_export'"
            ).fetchone()[0]
            == 1
        )


def test_clipping_export_rls_and_browser_write_denial():
    _prepare_database()
    actor_a, project_a = _current_project()
    export_a = _run(
        _repository().create(
            actor_a,
            project_a,
            ClippingExportRequestV1(expectedProjectRevision=1),
            idempotency_key="export-a",
        )
    )
    actor_b, project_b = _current_project()
    _run(
        _repository().create(
            actor_b,
            project_b,
            ClippingExportRequestV1(expectedProjectRevision=1),
            idempotency_key="export-b",
        )
    )
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,false)",
            (str(actor_a.user_id),),
        )
        rows = connection.execute(
            "SELECT id FROM clipping_exports ORDER BY id"
        ).fetchall()
        assert rows == [(UUID(export_a["exportId"]),)]
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "UPDATE clipping_exports SET status='ready' WHERE id=%s",
                (export_a["exportId"],),
            )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "SELECT storage_path,failure FROM clipping_exports WHERE id=%s",
                (export_a["exportId"],),
            )
        connection.execute("RESET ROLE")
        connection.execute("SET ROLE anon")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("SELECT id FROM clipping_exports")


def test_revision_and_dependency_changes_prevent_worker_finalization():
    mutations = (
        (
            "revision",
            """UPDATE clip_projects SET revision=2,
            project=jsonb_set(project,'{revision}','2'::jsonb) WHERE id=%s""",
            "export_revision_stale",
        ),
        (
            "edl",
            """UPDATE clip_projects
            SET latest_derivation_result_identity=%s WHERE id=%s""",
            "export_dependencies_stale",
        ),
        (
            "remapped",
            """UPDATE clip_projects SET latest_remapped_transcript=
            jsonb_set(latest_remapped_transcript,'{metadata,changed}','true'::jsonb,true)
            WHERE id=%s""",
            "export_dependencies_stale",
        ),
        (
            "conversion",
            """UPDATE clip_projects
            SET latest_conversion_result_identity=%s WHERE id=%s""",
            "export_dependencies_stale",
        ),
    )
    for name, statement, expected_code in mutations:
        _prepare_database()
        actor, project_id = _current_project()
        database = DurableDatabase(DATABASE_URL)
        repository = _repository()
        _run(_create_export(repository, actor, project_id, f"export-{name}"))
        _leases, _claim, context, value = _run(
            _claim_running(database, f"worker-{name}")
        )
        _run(repository.begin_render(context, value))
        parameters = (
            ("d" * 64, project_id)
            if name in {"edl", "conversion"}
            else (project_id,)
        )
        with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            connection.execute(statement, parameters)
        with pytest.raises(ProcessingJobFailure) as failure:
            _run(repository.finalize_success(context, value, _successful_output()))
        assert failure.value.code == expected_code
        with psycopg.connect(DATABASE_URL) as connection:
            assert connection.execute(
                "SELECT status FROM clipping_exports WHERE id=%s",
                (value.exportId,),
            ).fetchone() == ("rendering",)


def test_trusted_worker_finalization_is_atomic_on_database_failure():
    _prepare_database()
    actor, project_id = _current_project()
    database = DurableDatabase(DATABASE_URL)
    repository = _repository()
    created = _run(_create_export(repository, actor, project_id, "export-atomic"))
    _leases, claim, context, value = _run(_claim_running(database))
    _run(repository.begin_render(context, value))
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """CREATE FUNCTION reject_export_job_success() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN
              RAISE EXCEPTION 'forced finalization failure';
            END $$"""
        )
        connection.execute(
            """CREATE TRIGGER reject_export_job_success
            BEFORE UPDATE ON processing_jobs FOR EACH ROW
            WHEN (NEW.status='succeeded') EXECUTE FUNCTION reject_export_job_success()"""
        )
    with pytest.raises(PersistenceError) as failure:
        _run(repository.finalize_success(context, value, _successful_output()))
    assert failure.value.category == "transaction_failed"
    with psycopg.connect(DATABASE_URL) as connection:
        export_status = connection.execute(
            "SELECT status FROM clipping_exports WHERE id=%s",
            (created["exportId"],),
        ).fetchone()
        job_status = connection.execute(
            "SELECT status FROM processing_jobs WHERE id=%s", (claim.job_id,)
        ).fetchone()
        attempt_status = connection.execute(
            """SELECT status FROM processing_job_attempts
            WHERE job_id=%s AND attempt_number=%s""",
            (claim.job_id, claim.attempt_number),
        ).fetchone()
    assert (export_status, job_status, attempt_status) == (
        ("rendering",),
        ("running",),
        ("running",),
    )


def test_trusted_worker_success_and_queued_and_running_cancellation():
    _prepare_database()
    actor, project_id = _current_project()
    database = DurableDatabase(DATABASE_URL)
    repository = _repository()
    queued = _run(_create_export(repository, actor, project_id, "export-cancel-queued"))
    cancelled = _run(repository.cancel(actor, UUID(queued["exportId"])))
    assert cancelled["status"] == "cancelled"
    assert cancelled["jobStatus"] == "cancelled"

    _run(_create_export(repository, actor, project_id, "export-running"))
    leases, claim, context, value = _run(_claim_running(database))
    _run(repository.begin_render(context, value))
    requested = _run(repository.cancel(actor, value.exportId))
    assert requested["jobStatus"] == "cancel_requested"
    _run(repository.release_after_cancellation(context, value))
    _run(
        leases.acknowledge_cancellation(
            claim.job_id,
            worker_id=claim.worker_id,
            claim_token=claim.claim_token,
        )
    )
    with psycopg.connect(DATABASE_URL) as connection:
        statuses = connection.execute(
            """SELECT e.status,j.status,a.status,j.next_retry_at
            FROM clipping_exports e JOIN processing_jobs j
            ON j.id=e.processing_job_id JOIN processing_job_attempts a
            ON a.job_id=j.id WHERE e.id=%s""",
            (value.exportId,),
        ).fetchone()
    assert statuses == ("cancelled", "cancelled", "cancelled", None)

    _prepare_database()
    actor, project_id = _current_project()
    database = DurableDatabase(DATABASE_URL)
    repository = _repository()
    created = _run(_create_export(repository, actor, project_id, "export-success"))
    _leases, claim, context, value = _run(_claim_running(database))
    _run(repository.begin_render(context, value))
    _run(repository.finalize_success(context, value, _successful_output()))
    with psycopg.connect(DATABASE_URL) as connection:
        statuses = connection.execute(
            """SELECT e.status,j.status,a.status FROM clipping_exports e
            JOIN processing_jobs j ON j.id=e.processing_job_id
            JOIN processing_job_attempts a ON a.job_id=j.id
            WHERE e.id=%s""",
            (created["exportId"],),
        ).fetchone()
    assert statuses == ("ready", "succeeded", "succeeded")


def test_crash_after_upload_reuses_object_and_one_export_becomes_ready(tmp_path):
    _prepare_database()
    actor, project_id = _current_project()
    database = DurableDatabase(DATABASE_URL)
    repository = _repository()
    created = _run(_create_export(repository, actor, project_id, "export-replay"))
    leases, claim_a, context_a, value = _run(
        _claim_running(database, "export-worker-a")
    )
    _run(repository.begin_render(context_a, value))

    storage = LocalMediaStorage(tmp_path / "storage")
    rendered = tmp_path / "rendered.mp4"
    rendered.write_bytes(b"verified-rendered-output")
    checksum = hashlib.sha256(rendered.read_bytes()).hexdigest()
    path = export_object_path(value, actor.user_id)
    first_upload = _run(
        storage.upload_file(
            bucket="media-exports",
            path=path,
            local_path=rendered,
            content_type="video/mp4",
            maximum_bytes=1024,
            checksum=checksum,
        )
    )
    replay_upload = _run(
        storage.upload_file(
            bucket="media-exports",
            path=path,
            local_path=rendered,
            content_type="video/mp4",
            maximum_bytes=1024,
            checksum=checksum,
        )
    )
    assert replay_upload == first_upload
    conflicting = tmp_path / "conflicting.mp4"
    conflicting.write_bytes(b"different-output")
    with pytest.raises(StorageError):
        _run(
            storage.upload_file(
                bucket="media-exports",
                path=path,
                local_path=conflicting,
                content_type="video/mp4",
                maximum_bytes=1024,
                checksum=hashlib.sha256(conflicting.read_bytes()).hexdigest(),
            )
        )

    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """UPDATE processing_jobs SET lease_expires_at=now()-interval '1 second'
            WHERE id=%s""",
            (claim_a.job_id,),
        )
    recovered = _run(
        leases.sweep_recovery(
            batch_size=10,
            backoff=RetryBackoff(jitter_percent=0),
        )
    )
    assert recovered["leasesRecovered"] == 1
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """UPDATE processing_jobs SET next_retry_at=now()-interval '1 second',
            available_at=now()-interval '1 second' WHERE id=%s""",
            (claim_a.job_id,),
        )
    _run(
        leases.sweep_recovery(
            batch_size=10,
            backoff=RetryBackoff(jitter_percent=0),
        )
    )
    _leases, claim_b, context_b, replay_value = _run(
        _claim_running(database, "export-worker-b")
    )
    assert claim_b.job_id == claim_a.job_id
    assert claim_b.claim_token != claim_a.claim_token
    _run(repository.begin_render(context_b, replay_value))
    _run(
        repository.finalize_success(
            context_b,
            replay_value,
            {
                **_successful_output(),
                "storagePath": path,
                "sizeBytes": first_upload.size_bytes,
                "checksum": checksum,
            },
        )
    )
    with pytest.raises(JobOrchestrationError):
        _run(repository.finalize_success(context_a, value, _successful_output()))
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            """SELECT e.status,j.status,
            (SELECT count(*) FROM clipping_exports),
            (SELECT count(*) FROM processing_jobs WHERE job_type='clip_export')
            FROM clipping_exports e JOIN processing_jobs j
            ON j.id=e.processing_job_id WHERE e.id=%s""",
            (created["exportId"],),
        ).fetchone()
    assert row == ("ready", "succeeded", 1, 1)
