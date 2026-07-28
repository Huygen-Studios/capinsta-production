import asyncio
import json
import os
import selectors
from pathlib import Path
from uuid import uuid4

import pytest

psycopg = pytest.importorskip("psycopg")

from server.clipping_persistence.database import DurableDatabase
from server.clipping_jobs.models import JobExecutionContext
from server.clipping_storage.local_storage import LocalMediaStorage
from server.durable_transcription.config import DurableTranscriptionConfig
from server.durable_transcription.handler import TranscriptionJobHandler
from server.durable_transcription.planning import TranscriptionPlanningService
from server.durable_transcription.repository import (
    DurableTranscriptionRepository,
)
from server.media_variants.presets import AUDIO_SPEC, generation_spec_hash
from server.transcription_control import TranscriptionConfigSnapshot


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


def _prepare_database():
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
    migrations = [
        (
            ROOT / f"apps/web/migrations/{index:04d}_{name}.sql"
        ).read_text(encoding="utf-8")
        for index, name in (
            (14, "clipping_persistence"),
            (15, "supabase_media_storage"),
            (16, "processing_job_leases"),
            (17, "media_probe_handler"),
            (18, "media_variant_handlers"),
            (19, "durable_transcription_handler"),
        )
    ]
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        database_name = connection.execute(
            "SELECT current_database()"
        ).fetchone()[0]
        if "test" not in database_name.lower():
            raise RuntimeError("Refusing to reset a non-test database")
        connection.execute(bootstrap)
        for migration in migrations:
            connection.execute(migration)


def _insert_ready_audio():
    owner, asset, variant = uuid4(), uuid4(), uuid4()
    spec_hash = generation_spec_hash(AUDIO_SPEC)
    storage_path = (
        f"{owner}/{asset}/variants/audio_extract/r3/"
        f"{spec_hash[:12]}/audio.wav"
    )
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "INSERT INTO auth.users(id,email) VALUES (%s,%s)",
            (owner, f"{owner}@example.invalid"),
        )
        connection.execute(
            """
            INSERT INTO media_assets(
              id,owner_user_id,display_name,mime_type,media_kind,source_type,
              duration_ms,size_bytes,storage_bucket,storage_path,
              storage_object_revision,status,metadata,revision
            ) VALUES (
              %s,%s,'synthetic.mp4','video/mp4','video','uploaded',
              1000,100,'source-media',%s,1,'ready','{}'::jsonb,3
            )
            """,
            (asset, owner, f"{owner}/{asset}/source/v1.mp4"),
        )
        connection.execute(
            """
            INSERT INTO media_variants(
              id,media_asset_id,variant_type,mime_type,duration_ms,size_bytes,
              storage_bucket,storage_path,status,metadata,
              source_media_revision,source_storage_object_revision,
              generation_spec,generation_spec_hash,result_identity,revision,
              ready_at
            ) VALUES (
              %s,%s,'audio_extract','audio/wav',1000,32044,
              'media-variants',%s,'ready','{}'::jsonb,3,1,%s::jsonb,%s,%s,2,
              now()
            )
            """,
            (
                variant,
                asset,
                storage_path,
                json.dumps(AUDIO_SPEC),
                spec_hash,
                "b" * 64,
            ),
        )
    return owner, asset, variant, storage_path


def _claim(job_id):
    token = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """
            UPDATE processing_jobs SET status='running',attempt_count=1,
              worker_id='test-worker',claim_token=%s,claimed_at=now(),
              started_at=now(),heartbeat_at=now(),
              lease_expires_at=now()+interval '5 minutes'
            WHERE id=%s
            """,
            (token, job_id),
        )
        connection.execute(
            """
            INSERT INTO processing_job_attempts(
              job_id,attempt_number,worker_id,claim_token,status,started_at,
              lease_expires_at
            ) VALUES (%s,1,'test-worker',%s,'running',now(),
              now()+interval '5 minutes')
            """,
            (job_id, token),
        )

    async def heartbeat(**kwargs):
        return kwargs

    async def cancelled():
        return False

    return JobExecutionContext(
        job_id=job_id,
        attempt_number=1,
        worker_id="test-worker",
        claim_token=token,
        heartbeat_callback=heartbeat,
        cancellation_callback=cancelled,
        shutdown_event=asyncio.Event(),
        maximum_attempts=3,
        execution_timeout_seconds=60,
    )


class _FakePipeline:
    async def transcribe(self, **kwargs):
        del kwargs
        return {
            "detectedLanguage": "en",
            "timingProvenance": "provider_word",
            "segments": [
                {
                    "start": 0.1,
                    "end": 0.8,
                    "text": "Durable test",
                    "words": [
                        {
                            "word": "Durable",
                            "start": 0.1,
                            "end": 0.4,
                            "confidence": 0.9,
                            "timing_source": "provider_word",
                        },
                        {
                            "word": "test",
                            "start": 0.45,
                            "end": 0.8,
                            "confidence": 0.8,
                            "timing_source": "provider_word",
                        },
                    ],
                }
            ],
        }


def _real_handler(tmp_path):
    storage = LocalMediaStorage(tmp_path / "storage")
    snapshot = TranscriptionConfigSnapshot(
        configuration_id="cfg-test",
        provider="sarvam",
        model="saaras:v3",
        version=1,
        provider_options={},
        timestamp_strategy="word",
    )
    return TranscriptionJobHandler(
        config=DurableTranscriptionConfig(
            enabled=True,
            temp_root=tmp_path / "work",
            storage_backend="local",
            local_storage_root=str(storage.root),
            maximum_source_bytes=10_000_000,
        ),
        storage=storage,
        repository=DurableTranscriptionRepository(
            DurableDatabase(DATABASE_URL)
        ),
        configuration_snapshot=snapshot,
        pipeline=_FakePipeline(),
    ), storage


def test_migration_accepts_legacy_rows_and_restricts_worker_only_columns():
    _prepare_database()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        columns = {
            row[0]
            for row in connection.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema='public' AND table_name='transcripts'
                """
            )
        }
        assert {
            "request_identity",
            "result_identity",
            "failure",
            "audio_variant_id",
            "ready_at",
        } <= columns
        assert connection.execute(
            """
            SELECT has_column_privilege(
              'authenticated','public.transcripts','result_identity','SELECT'
            )
            """
        ).fetchone()[0] is False
        assert connection.execute(
            """
            SELECT has_column_privilege(
              'authenticated','public.transcripts','document','SELECT'
            )
            """
        ).fetchone()[0] is True


def test_planning_is_idempotent_and_revision_bound():
    _prepare_database()
    owner, asset, variant, _ = _insert_ready_audio()
    service = TranscriptionPlanningService(DurableDatabase(DATABASE_URL))
    first = _run(
        service.plan(
            asset,
            language_mode="hinglish",
            provider_preference="sarvam",
            hotwords=["Capinsta"],
        )
    )
    second = _run(
        service.plan(
            asset,
            language_mode="hinglish",
            provider_preference="sarvam",
            hotwords=["Capinsta"],
        )
    )
    assert first["transcript"]["id"] == second["transcript"]["id"]
    assert first["job"]["id"] == second["job"]["id"]
    assert first["audioVariant"]["id"] == variant
    payload = first["job"]["input"]
    assert payload["expectedMediaRevision"] == 3
    assert payload["storageObjectRevision"] == 1
    assert payload["audioVariantRevision"] == 2
    assert "signedUrl" not in payload
    with psycopg.connect(DATABASE_URL) as connection:
        counts = connection.execute(
            """
            SELECT
              (SELECT count(*) FROM transcripts WHERE owner_user_id=%s),
              (SELECT count(*) FROM processing_jobs
                WHERE owner_user_id=%s AND job_type='transcription')
            """,
            (owner, owner),
        ).fetchone()
    assert counts == (1, 1)


def test_database_constraints_reject_partial_or_invalid_identity():
    _prepare_database()
    owner, asset, variant, _ = _insert_ready_audio()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                """
                INSERT INTO transcripts(
                  id,owner_user_id,media_asset_id,schema_version,duration_ms,
                  status,document,request_identity
                ) VALUES (
                  'tr_invalid',%s,%s,2,1000,'queued','{}'::jsonb,%s
                )
                """,
                (owner, asset, "a" * 64),
            )
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                """
                INSERT INTO transcripts(
                  id,owner_user_id,media_asset_id,schema_version,duration_ms,
                  status,document,media_revision,storage_object_revision,
                  audio_variant_id,audio_variant_revision,request_identity
                ) VALUES (
                  'tr_bad_hash',%s,%s,2,1000,'queued','{}'::jsonb,
                  3,1,%s,2,'not-a-hash'
                )
                """,
                (owner, asset, variant),
            )


def test_handler_atomically_persists_transcript_job_and_attempt(tmp_path):
    _prepare_database()
    owner, asset, _, storage_path = _insert_ready_audio()
    plan = _run(
        TranscriptionPlanningService(DurableDatabase(DATABASE_URL)).plan(
            asset,
            language_mode="english",
            provider_preference="sarvam",
        )
    )
    handler, storage = _real_handler(tmp_path)
    source = storage.root / "media-variants" / Path(*storage_path.split("/"))
    source.parent.mkdir(parents=True)
    source.write_bytes(b"RIFF-synthetic-audio")
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "UPDATE media_variants SET size_bytes=%s WHERE id=%s",
            (source.stat().st_size, plan["audioVariant"]["id"]),
        )
    context = _claim(plan["job"]["id"])
    result = _run(handler.execute(context, plan["job"]["input"]))
    assert result.finalized is True
    with psycopg.connect(DATABASE_URL) as connection:
        transcript = connection.execute(
            """
            SELECT status,document,result_identity,ready_at,failure
            FROM transcripts WHERE id=%s
            """,
            (plan["transcript"]["id"],),
        ).fetchone()
        job = connection.execute(
            """
            SELECT status,progress,worker_id,claim_token,output
            FROM processing_jobs WHERE id=%s
            """,
            (plan["job"]["id"],),
        ).fetchone()
        attempt = connection.execute(
            """
            SELECT status,output_summary
            FROM processing_job_attempts
            WHERE job_id=%s AND attempt_number=1
            """,
            (plan["job"]["id"],),
        ).fetchone()
    assert transcript[0] == "ready"
    assert transcript[1]["schemaVersion"] == 2
    assert transcript[1]["mediaId"] == str(asset)
    assert transcript[2] == result.output["resultIdentity"]
    assert transcript[3] is not None and transcript[4] is None
    assert job[0:4] == ("succeeded", 100, None, None)
    assert job[4]["transcriptId"] == transcript[1]["transcriptId"]
    assert attempt[0] == "succeeded"
    assert attempt[1]["resultIdentity"] == transcript[2]
    serialized = json.dumps(
        {"transcript": transcript[1], "output": job[4]}
    )
    assert "http" not in serialized
    assert "capinsta_test_password" not in serialized


def test_missing_attempt_forces_atomic_success_rollback(tmp_path):
    _prepare_database()
    _, asset, _, storage_path = _insert_ready_audio()
    plan = _run(
        TranscriptionPlanningService(DurableDatabase(DATABASE_URL)).plan(
            asset,
            language_mode="english",
            provider_preference="sarvam",
        )
    )
    handler, storage = _real_handler(tmp_path)
    source = storage.root / "media-variants" / Path(*storage_path.split("/"))
    source.parent.mkdir(parents=True)
    source.write_bytes(b"RIFF-synthetic-audio")
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "UPDATE media_variants SET size_bytes=%s WHERE id=%s",
            (source.stat().st_size, plan["audioVariant"]["id"]),
        )
    context = _claim(plan["job"]["id"])
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "DELETE FROM processing_job_attempts WHERE job_id=%s",
            (plan["job"]["id"],),
        )
    with pytest.raises(Exception):
        _run(handler.execute(context, plan["job"]["input"]))
    with psycopg.connect(DATABASE_URL) as connection:
        transcript_status = connection.execute(
            "SELECT status FROM transcripts WHERE id=%s",
            (plan["transcript"]["id"],),
        ).fetchone()[0]
        job_status = connection.execute(
            "SELECT status FROM processing_jobs WHERE id=%s",
            (plan["job"]["id"],),
        ).fetchone()[0]
    assert transcript_status != "ready"
    assert job_status != "succeeded"


@pytest.mark.parametrize(
    ("target", "expected_code"),
    [
        ("media", "transcription_media_revision_mismatch"),
        ("variant", "transcription_audio_variant_stale"),
    ],
)
def test_stale_media_or_audio_cannot_become_ready(
    tmp_path, target, expected_code
):
    _prepare_database()
    _, asset, variant, _ = _insert_ready_audio()
    plan = _run(
        TranscriptionPlanningService(DurableDatabase(DATABASE_URL)).plan(
            asset,
            language_mode="english",
            provider_preference="sarvam",
        )
    )
    context = _claim(plan["job"]["id"])
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        if target == "media":
            connection.execute(
                "UPDATE media_assets SET revision=revision+1 WHERE id=%s",
                (asset,),
            )
        else:
            connection.execute(
                "UPDATE media_variants SET revision=revision+1 WHERE id=%s",
                (variant,),
            )
    handler, _ = _real_handler(tmp_path)
    with pytest.raises(Exception) as error:
        _run(handler.execute(context, plan["job"]["input"]))
    assert getattr(error.value, "code", None) == expected_code
    with psycopg.connect(DATABASE_URL) as connection:
        transcript = connection.execute(
            "SELECT status,result_identity FROM transcripts WHERE id=%s",
            (plan["transcript"]["id"],),
        ).fetchone()
        job = connection.execute(
            "SELECT status,failure_code FROM processing_jobs WHERE id=%s",
            (plan["job"]["id"],),
        ).fetchone()
    assert transcript == ("failed", None)
    assert job == ("failed", expected_code)


def test_concurrent_planners_reuse_one_transcript_and_job():
    _prepare_database()
    owner, asset, _, _ = _insert_ready_audio()

    async def plan_twice():
        first = TranscriptionPlanningService(DurableDatabase(DATABASE_URL))
        second = TranscriptionPlanningService(DurableDatabase(DATABASE_URL))
        return await asyncio.gather(
            first.plan(asset, language_mode="auto"),
            second.plan(asset, language_mode="auto"),
        )

    left, right = _run(plan_twice())
    assert left["transcript"]["id"] == right["transcript"]["id"]
    assert left["job"]["id"] == right["job"]["id"]
    with psycopg.connect(DATABASE_URL) as connection:
        counts = connection.execute(
            """
            SELECT
              (SELECT count(*) FROM transcripts WHERE owner_user_id=%s),
              (SELECT count(*) FROM processing_jobs
                WHERE owner_user_id=%s AND job_type='transcription')
            """,
            (owner, owner),
        ).fetchone()
    assert counts == (1, 1)
