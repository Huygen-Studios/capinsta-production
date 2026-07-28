import asyncio
import json
import os
import selectors
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

import pytest

psycopg = pytest.importorskip("psycopg")

from server.clipping_persistence import (
    AuthenticatedActor,
    ClipProjectRepository,
    DurableDatabase,
    IdempotencyRepository,
    MediaAssetRepository,
    PersistenceError,
    ProcessingJobRepository,
    TranscriptRepository,
)

ROOT = Path(__file__).resolve().parents[2]
DATABASE_URL = os.getenv("CLIPPING_PERSISTENCE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="Disposable Supabase-compatible PostgreSQL URL required"
)


def _run(coro):
    if os.name == "nt":
        with asyncio.Runner(
            loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector())
        ) as runner:
            return runner.run(coro)
    return asyncio.run(coro)


def _prepare_database() -> None:
    bootstrap = """
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
    migration = (
        ROOT / "apps/web/migrations/0014_clipping_persistence.sql"
    ).read_text(encoding="utf-8")
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        database_name = connection.execute("SELECT current_database()").fetchone()[0]
        if "test" not in database_name.lower():
            raise RuntimeError(
                "Refusing to reset a database whose name does not contain 'test'"
            )
        connection.execute(bootstrap)
        connection.execute(migration)


def _documents(media_id: UUID) -> tuple[dict, dict]:
    transcript = json.loads(
        (ROOT / "contracts/fixtures/transcript-document-v2/empty.json").read_text(
            encoding="utf-8"
        )
    )
    transcript["transcriptId"] = "tr_persistence"
    transcript["mediaId"] = str(media_id)
    project = json.loads(
        (ROOT / "contracts/fixtures/clip-project-v1/empty.json").read_text(
            encoding="utf-8"
        )
    )
    project["clipProjectId"] = "clip_persistence"
    project["sourceMedia"]["mediaId"] = str(media_id)
    project["transcriptId"] = "tr_persistence"
    project["transcriptRevision"] = 1
    return transcript, project


def test_migration_and_rls_with_two_users_and_service_role():
    _prepare_database()
    user_a, user_b = uuid4(), uuid4()
    asset_a, asset_b = uuid4(), uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "INSERT INTO auth.users(id,email) VALUES (%s,'a@example.invalid'),(%s,'b@example.invalid')",
            (user_a, user_b),
        )
        connection.execute(
            """
            INSERT INTO media_assets(id,owner_user_id,display_name)
            VALUES (%s,%s,'A'),(%s,%s,'B')
            """,
            (asset_a, user_a, asset_b, user_b),
        )
        assert connection.execute(
            """
            SELECT count(*) FROM pg_tables
            WHERE schemaname='public' AND tablename IN (
              'media_assets','media_variants','transcripts','clip_projects',
              'clip_project_versions','processing_jobs','idempotency_records'
            )
            """
        ).fetchone()[0] == 7
        assert connection.execute(
            """
            SELECT count(*) FROM pg_policies
            WHERE schemaname='public' AND tablename IN (
              'media_assets','media_variants','transcripts','clip_projects',
              'clip_project_versions','processing_jobs','idempotency_records'
            )
            """
        ).fetchone()[0] == 7
        assert connection.execute(
            """
            SELECT count(*) FROM pg_constraint
            WHERE contype='f' AND connamespace='public'::regnamespace
              AND conrelid IN (
                'media_assets'::regclass,'media_variants'::regclass,
                'transcripts'::regclass,'clip_projects'::regclass,
                'clip_project_versions'::regclass,'processing_jobs'::regclass,
                'idempotency_records'::regclass
              )
            """
        ).fetchone()[0] >= 10
        assert connection.execute(
            """
            SELECT count(*) FROM pg_indexes
            WHERE schemaname='public' AND indexname IN (
              'media_assets_owner_idx','transcripts_media_idx',
              'clip_projects_owner_updated_idx',
              'processing_jobs_status_available_idx',
              'idempotency_records_expiry_idx'
            )
            """
        ).fetchone()[0] == 5
        assert connection.execute(
            """
            SELECT count(*) FROM pg_tables
            WHERE schemaname='public' AND rowsecurity AND tablename IN (
              'media_assets','media_variants','transcripts','clip_projects',
              'clip_project_versions','processing_jobs','idempotency_records'
            )
            """
        ).fetchone()[0] == 7

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,true)", (str(user_a),)
        )
        assert connection.execute(
            "SELECT id FROM media_assets ORDER BY id"
        ).fetchall() == [(asset_a,)]
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "UPDATE media_assets SET owner_user_id=%s WHERE id=%s",
                (user_b, asset_a),
            )
        connection.rollback()
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,true)", (str(user_a),)
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "UPDATE media_assets SET display_name='x' WHERE id=%s", (asset_b,)
            )

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE anon")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("SELECT * FROM media_assets")

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE service_role")
        assert connection.execute("SELECT count(*) FROM media_assets").fetchone()[0] == 2
        connection.execute(
            "UPDATE media_assets SET storage_bucket='private',storage_path='a/source.mp4' WHERE id=%s",
            (asset_a,),
        )
        connection.commit()


def test_repositories_contracts_revisions_jobs_and_idempotency():
    _prepare_database()
    user_a, user_b = uuid4(), uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "INSERT INTO auth.users(id,email) VALUES (%s,'a@example.invalid'),(%s,'b@example.invalid')",
            (user_a, user_b),
        )

    async def scenario():
        database = DurableDatabase(DATABASE_URL)
        actor = AuthenticatedActor(user_a)
        other = AuthenticatedActor(user_b)
        media_repository = MediaAssetRepository(database)
        transcript_repository = TranscriptRepository(database)
        project_repository = ClipProjectRepository(database)
        job_repository = ProcessingJobRepository(database)
        idempotency_repository = IdempotencyRepository(database)

        media = await media_repository.create(
            actor,
            display_name="Synthetic.mp4",
            media_kind="video",
            source_type="uploaded",
            duration_ms=0,
            metadata={"synthetic": True},
        )
        fetched = await media_repository.get(actor, media["id"])
        assert fetched["display_name"] == "Synthetic.mp4"
        media = await media_repository.update_metadata(
            actor, media["id"], {"edited": True}, expected_revision=1
        )
        assert media["revision"] == 2
        media = await media_repository.set_storage_reference(
            actor,
            media["id"],
            storage_bucket="capinsta-media",
            storage_path=f"{user_a}/clip/source.mp4",
            expected_revision=2,
        )
        assert media["storage_bucket"] == "capinsta-media"
        with pytest.raises(PersistenceError) as unauthorized:
            await media_repository.get(other, media["id"])
        assert unauthorized.value.category == "entity_not_found"

        transcript_document, project_document = _documents(media["id"])
        transcript = await transcript_repository.create(
            actor,
            transcript_id="tr_persistence",
            media_asset_id=media["id"],
            document=transcript_document,
        )
        assert transcript["document"] == transcript_document
        assert len(await transcript_repository.list_for_media(actor, media["id"])) == 1
        invalid = dict(transcript_document)
        invalid["mediaId"] = str(uuid4())
        with pytest.raises(PersistenceError) as mismatch:
            await transcript_repository.update_document(
                actor,
                "tr_persistence",
                invalid,
                expected_revision=1,
            )
        assert mismatch.value.category == "invalid_contract"

        project = await project_repository.create(
            actor,
            project_id="clip_persistence",
            source_media_asset_id=media["id"],
            transcript_id="tr_persistence",
            project=project_document,
        )
        assert project["revision"] == 1
        updated_document = dict(project_document)
        updated_document["revision"] = 2
        updated_document["name"] = "Updated"
        project = await project_repository.update_with_expected_revision(
            actor,
            "clip_persistence",
            updated_document,
            expected_revision=1,
        )
        assert project["revision"] == 2
        project = await project_repository.set_derived_cache(
            actor,
            "clip_persistence",
            expected_revision=2,
            edl={
                "schemaVersion": 1,
                "clipProjectId": "clip_persistence",
                "projectRevision": 2,
                "sourceMediaId": str(media["id"]),
                "sourceDurationMs": 0,
                "outputDurationMs": 0,
                "entries": [],
                "warnings": [],
                "metadata": {},
            },
            remapped_transcript={
                "schemaVersion": 1,
                "sourceTranscriptId": "tr_persistence",
                "clipProjectId": "clip_persistence",
                "projectRevision": 2,
                "sourceMediaId": str(media["id"]),
                "outputDurationMs": 0,
                "segments": [],
                "words": [],
                "warnings": [],
                "metadata": {},
            },
            conversion_result={
                "schemaVersion": 1,
                "sourceClipProjectId": "clip_persistence",
                "sourceClipProjectRevision": 2,
                "mapping": {"sourceMediaId": str(media["id"])},
                "project": {"version": 35},
            },
        )
        assert project["latest_edl"]["projectRevision"] == 2
        with pytest.raises(PersistenceError) as stale:
            await project_repository.update_with_expected_revision(
                actor,
                "clip_persistence",
                updated_document,
                expected_revision=1,
            )
        assert stale.value.category == "stale_revision"

        job_input = {
            "schemaVersion": 1,
            "jobType": "transcription",
            "mediaAssetId": str(media["id"]),
            "languageMode": "auto",
        }
        job, replayed = await job_repository.create_idempotent(
            actor,
            idempotency_repository,
            scope=f"{user_a}:transcription",
            idempotency_key="same-request",
            request_hash="hash-a",
            job_type="transcription",
            input=job_input,
            media_asset_id=media["id"],
        )
        assert replayed is False and job["status"] == "queued"
        replay, replayed = await job_repository.create_idempotent(
            actor,
            idempotency_repository,
            scope=f"{user_a}:transcription",
            idempotency_key="same-request",
            request_hash="hash-a",
            job_type="transcription",
            input=job_input,
            media_asset_id=media["id"],
        )
        assert replayed is True and replay["id"] == job["id"]
        with pytest.raises(PersistenceError) as conflict:
            await idempotency_repository.begin(
                actor,
                scope=f"{user_a}:transcription",
                idempotency_key="same-request",
                request_hash="hash-b",
            )
        assert conflict.value.category == "idempotency_conflict"

        job = await job_repository.transition(
            actor, job["id"], "claimed", expected_revision=1, worker_id="test"
        )
        job = await job_repository.transition(
            actor, job["id"], "running", expected_revision=2
        )
        assert job["attempt_count"] == 1
        job = await job_repository.update_progress(
            actor, job["id"], 50, expected_revision=3, current_stage="transcribe"
        )
        job = await job_repository.record_heartbeat(
            actor, job["id"], expected_revision=4, worker_id="test"
        )
        job = await job_repository.schedule_retry(
            actor,
            job["id"],
            expected_revision=5,
            available_at=datetime.now(timezone.utc) + timedelta(seconds=5),
        )
        assert job["status"] == "retry_wait"
        with pytest.raises(PersistenceError) as invalid_transition:
            await job_repository.transition(
                actor, job["id"], "succeeded", expected_revision=6
            )
        assert invalid_transition.value.category == "invalid_job_transition"
        with pytest.raises(PersistenceError) as progress:
            await job_repository.update_progress(
                actor, job["id"], 101, expected_revision=6
            )
        assert progress.value.category == "invalid_job_progress"

        second = await job_repository.create(
            actor,
            job_type="transcription",
            input=job_input,
            media_asset_id=media["id"],
        )
        cancelled = await job_repository.request_cancel(
            actor, second["id"], expected_revision=1
        )
        assert cancelled["status"] == "cancel_requested"
        assert cancelled["cancel_requested_at"] is not None

        successful = await job_repository.create(
            actor,
            job_type="transcription",
            input=job_input,
            media_asset_id=media["id"],
        )
        successful = await job_repository.transition(
            actor, successful["id"], "claimed", expected_revision=1
        )
        successful = await job_repository.transition(
            actor, successful["id"], "running", expected_revision=2
        )
        successful = await job_repository.transition(
            actor, successful["id"], "succeeded", expected_revision=3
        )
        assert successful["progress"] == 100
        with pytest.raises(PersistenceError):
            await job_repository.update_progress(
                actor, successful["id"], 90, expected_revision=4
            )

        pending, created = await idempotency_repository.begin(
            actor,
            scope=f"{user_a}:pending",
            idempotency_key="pending",
            request_hash="pending-hash",
        )
        assert created is True and pending["status"] == "in_progress"
        with pytest.raises(PersistenceError) as in_progress:
            await idempotency_repository.begin(
                actor,
                scope=f"{user_a}:pending",
                idempotency_key="pending",
                request_hash="pending-hash",
            )
        assert in_progress.value.category == "idempotency_in_progress"
        failed = await idempotency_repository.mark_failed(
            actor,
            scope=f"{user_a}:pending",
            idempotency_key="pending",
            response_code=503,
            response={"code": "retry_later"},
        )
        assert failed["status"] == "failed"
        expired = await idempotency_repository.expire(
            actor,
            scope=f"{user_a}:pending",
            idempotency_key="pending",
        )
        assert expired["status"] == "expired"
        reserved_again, created = await idempotency_repository.begin(
            actor,
            scope=f"{user_a}:pending",
            idempotency_key="pending",
            request_hash="pending-hash",
        )
        assert created is True and reserved_again["status"] == "in_progress"

        archived = await project_repository.archive(actor, "clip_persistence")
        assert archived["status"] == "archived"
        deleted_project = await project_repository.mark_deleted(
            actor, "clip_persistence"
        )
        assert deleted_project["deleted_at"] is not None
        deleted_media = await media_repository.mark_deleted(actor, media["id"])
        assert deleted_media["deleted_at"] is not None

    _run(scenario())
