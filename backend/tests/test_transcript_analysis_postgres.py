import asyncio
import json
import os
import selectors
from pathlib import Path
from uuid import uuid4

import pytest

psycopg = pytest.importorskip("psycopg")

from backend.contracts.transcript_document_v2 import TranscriptDocumentV2
from server.clipping_persistence.database import DurableDatabase
from server.clipping_jobs.models import JobExecutionContext
from server.transcript_analysis.config import TranscriptAnalysisConfig
from server.transcript_analysis.handlers import (
    SilenceAnalysisJobHandler,
    TranscriptAnalysisJobHandler,
)
from server.clipping_storage.local_storage import LocalMediaStorage
from server.transcript_analysis.planning import TranscriptAnalysisPlanningService
from server.transcript_analysis.repository import TranscriptAnalysisRepository
from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure

ROOT = Path(__file__).resolve().parents[2]
DATABASE_URL = os.getenv("CLIPPING_PERSISTENCE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="Disposable PostgreSQL 17 test URL required"
)


def _run(coro):
    if os.name == "nt":
        with asyncio.Runner(
            loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector())
        ) as runner:
            return runner.run(coro)
    return asyncio.run(coro)


def _prepare_database():
    bootstrap = """
      DROP SCHEMA IF EXISTS storage CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      DROP SCHEMA IF EXISTS auth CASCADE;
      CREATE SCHEMA public; CREATE SCHEMA auth;
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
      CREATE TABLE auth.users (id uuid PRIMARY KEY,email text);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    """
    names = (
        (14, "clipping_persistence"),
        (15, "supabase_media_storage"),
        (16, "processing_job_leases"),
        (17, "media_probe_handler"),
        (18, "media_variant_handlers"),
        (19, "durable_transcription_handler"),
        (20, "transcript_analysis"),
    )
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        if "test" not in connection.execute("SELECT current_database()").fetchone()[0].lower():
            raise RuntimeError("Refusing to reset a non-test database")
        connection.execute(bootstrap)
        for index, name in names:
            connection.execute(
                (ROOT / f"apps/web/migrations/{index:04d}_{name}.sql").read_text("utf-8")
            )


def _insert_ready_transcript(owner=None):
    owner = owner or uuid4()
    asset, variant = uuid4(), uuid4()
    raw = json.loads(
        (ROOT / "contracts/fixtures/transcript-document-v2/low-confidence.json").read_text("utf-8")
    )
    raw["mediaId"] = str(asset)
    transcript = TranscriptDocumentV2.model_validate(raw)
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "INSERT INTO auth.users(id,email) VALUES (%s,%s)",
            (owner, f"{owner}@example.invalid"),
        )
        connection.execute(
            """INSERT INTO media_assets(
            id,owner_user_id,display_name,mime_type,media_kind,source_type,duration_ms,
            size_bytes,storage_bucket,storage_path,storage_object_revision,status,metadata,revision
            ) VALUES (%s,%s,'analysis.mp4','video/mp4','video','uploaded',%s,100,
            'source-media',%s,1,'ready','{}',3)""",
            (asset, owner, transcript.durationMs, f"{owner}/{asset}/source/v1.mp4"),
        )
        connection.execute(
            """INSERT INTO media_variants(
            id,media_asset_id,variant_type,mime_type,duration_ms,size_bytes,
            storage_bucket,storage_path,status,metadata,source_media_revision,
            source_storage_object_revision,generation_spec,generation_spec_hash,
            result_identity,revision,ready_at
            ) VALUES (%s,%s,'audio_extract','audio/wav',%s,32044,'media-variants',
            %s,'ready','{}',3,1,%s,%s,%s,2,now())""",
            (
                variant, asset, transcript.durationMs,
                f"{owner}/{asset}/variants/audio_extract/r3/{'a' * 12}/audio.wav",
                json.dumps({"preset": "transcription-wav-16k-mono-v1"}),
                "a" * 64, "b" * 64,
            ),
        )
        connection.execute(
            """INSERT INTO transcripts(
            id,owner_user_id,media_asset_id,schema_version,language_mode,duration_ms,
            status,revision,document,quality,metadata,media_revision,
            storage_object_revision,audio_variant_id,audio_variant_revision,
            request_identity,result_identity,ready_at
            ) VALUES (%s,%s,%s,2,%s,%s,'ready',1,%s,%s,'{}',3,1,%s,2,%s,%s,now())""",
            (
                transcript.transcriptId, owner, asset, transcript.languageMode,
                transcript.durationMs, json.dumps(transcript.model_dump(mode="json")),
                json.dumps(transcript.quality.model_dump(mode="json")),
                variant, "c" * 64, "d" * 64,
            ),
        )
    return owner, asset, variant, transcript


def _claim(job_id):
    token = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """UPDATE processing_jobs SET status='running',attempt_count=1,
            worker_id='analysis-test',claim_token=%s,claimed_at=now(),started_at=now(),
            heartbeat_at=now(),lease_expires_at=now()+interval '5 minutes' WHERE id=%s""",
            (token, job_id),
        )
        connection.execute(
            """INSERT INTO processing_job_attempts(
            job_id,attempt_number,worker_id,claim_token,status,started_at,lease_expires_at
            ) VALUES (%s,1,'analysis-test',%s,'running',now(),now()+interval '5 minutes')""",
            (job_id, token),
        )

    async def heartbeat(**kwargs):
        return kwargs

    async def cancelled():
        return False

    return JobExecutionContext(
        job_id=job_id, attempt_number=1, worker_id="analysis-test",
        claim_token=token, heartbeat_callback=heartbeat,
        cancellation_callback=cancelled, shutdown_event=asyncio.Event(),
        maximum_attempts=3, execution_timeout_seconds=120,
    )


def test_planning_is_idempotent_and_concurrent_safe():
    _prepare_database()
    _, _, _, transcript = _insert_ready_transcript()
    service = TranscriptAnalysisPlanningService(DurableDatabase(DATABASE_URL))
    async def concurrent():
        return await asyncio.gather(
            service.plan(transcript.transcriptId, include_silence=False),
            service.plan(transcript.transcriptId, include_silence=False),
        )
    first, second = _run(concurrent())
    assert first["transcriptReview"]["analysis"]["id"] == second["transcriptReview"]["analysis"]["id"]
    assert first["transcriptReview"]["job"]["id"] == second["transcriptReview"]["job"]["id"]
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute("SELECT count(*) FROM transcript_analyses").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM processing_jobs").fetchone()[0] == 1


def test_transcript_handler_atomic_success_and_stale_revision_rejection():
    _prepare_database()
    _, _, _, transcript = _insert_ready_transcript()
    service = TranscriptAnalysisPlanningService(DurableDatabase(DATABASE_URL))
    plan = _run(service.plan(transcript.transcriptId, include_silence=False))
    target = plan["transcriptReview"]
    job = target["job"]
    original = json.dumps(transcript.model_dump(mode="json"), sort_keys=True)
    handler = TranscriptAnalysisJobHandler(
        config=TranscriptAnalysisConfig(handlers_enabled=True),
        repository=TranscriptAnalysisRepository(DurableDatabase(DATABASE_URL)),
    )
    result = _run(handler.execute(_claim(job["id"]), job["input"]))
    assert result.finalized
    with psycopg.connect(DATABASE_URL) as connection:
        analysis = connection.execute(
            "SELECT status,document,result_identity FROM transcript_analyses"
        ).fetchone()
        assert analysis[0] == "ready" and analysis[1] and analysis[2]
        assert connection.execute(
            "SELECT count(*) FROM timeline_recommendations WHERE analysis_id=%s",
            (target["analysis"]["id"],),
        ).fetchone()[0] > 0
        assert connection.execute(
            "SELECT status,worker_id,claim_token FROM processing_jobs WHERE id=%s",
            (job["id"],),
        ).fetchone() == ("succeeded", None, None)
        persisted = connection.execute(
            "SELECT document FROM transcripts WHERE id=%s", (transcript.transcriptId,)
        ).fetchone()[0]
        assert json.dumps(persisted, sort_keys=True) == original


def test_rls_is_owner_scoped_and_browser_cannot_write():
    _prepare_database()
    owner_a, _, _, transcript = _insert_ready_transcript()
    owner_b = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id,email) VALUES (%s,'b@example.invalid')", (owner_b,))
    service = TranscriptAnalysisPlanningService(DurableDatabase(DATABASE_URL))
    _run(service.plan(transcript.transcriptId, include_silence=False))
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute("SELECT set_config('request.jwt.claim.sub',%s,false)", (str(owner_a),))
        assert connection.execute("SELECT count(*) FROM transcript_analyses").fetchone()[0] == 1
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("UPDATE transcript_analyses SET status='ready'")
        connection.execute("RESET ROLE")
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute("SELECT set_config('request.jwt.claim.sub',%s,false)", (str(owner_b),))
        assert connection.execute("SELECT count(*) FROM transcript_analyses").fetchone()[0] == 0


def test_atomic_rollback_on_recommendation_failure():
    _prepare_database()
    _, _, _, transcript = _insert_ready_transcript()
    service = TranscriptAnalysisPlanningService(DurableDatabase(DATABASE_URL))
    target = _run(service.plan(transcript.transcriptId, include_silence=False))["transcriptReview"]
    handler = TranscriptAnalysisJobHandler(
        config=TranscriptAnalysisConfig(handlers_enabled=True),
        repository=TranscriptAnalysisRepository(DurableDatabase(DATABASE_URL)),
    )
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """CREATE FUNCTION reject_test_recommendations() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced rollback'; END $$"""
        )
        connection.execute(
            """CREATE TRIGGER reject_test_recommendations BEFORE INSERT
            ON timeline_recommendations FOR EACH ROW
            EXECUTE FUNCTION reject_test_recommendations()"""
        )
    with pytest.raises(JobOrchestrationError):
        _run(handler.execute(_claim(target["job"]["id"]), target["job"]["input"]))
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute(
            "SELECT status FROM transcript_analyses WHERE id=%s",
            (target["analysis"]["id"],),
        ).fetchone()[0] == "normalizing"
        assert connection.execute(
            "SELECT count(*) FROM timeline_recommendations"
        ).fetchone()[0] == 0
        assert connection.execute(
            "SELECT status FROM processing_jobs WHERE id=%s",
            (target["job"]["id"],),
        ).fetchone()[0] == "running"


def test_stale_transcript_cannot_finalize():
    _prepare_database()
    _, _, _, transcript = _insert_ready_transcript()
    service = TranscriptAnalysisPlanningService(DurableDatabase(DATABASE_URL))
    target = _run(service.plan(transcript.transcriptId, include_silence=False))["transcriptReview"]
    context = _claim(target["job"]["id"])
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "UPDATE transcripts SET revision=revision+1 WHERE id=%s",
            (transcript.transcriptId,),
        )
    handler = TranscriptAnalysisJobHandler(
        config=TranscriptAnalysisConfig(handlers_enabled=True),
        repository=TranscriptAnalysisRepository(DurableDatabase(DATABASE_URL)),
    )
    with pytest.raises(ProcessingJobFailure) as caught:
        _run(handler.execute(context, target["job"]["input"]))
    assert caught.value.code == "transcript_revision_mismatch"
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute(
            "SELECT status FROM transcript_analyses WHERE id=%s",
            (target["analysis"]["id"],),
        ).fetchone()[0] == "queued"


def test_silence_handler_persists_intervals_and_proposals(tmp_path):
    _prepare_database()
    _, _, _, transcript = _insert_ready_transcript()
    service = TranscriptAnalysisPlanningService(DurableDatabase(DATABASE_URL))
    target = _run(service.plan(transcript.transcriptId, include_transcript_review=False))["silence"]
    storage = LocalMediaStorage(tmp_path / "storage")
    variant = target["analysis"]
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        bucket, object_path = connection.execute(
            "SELECT storage_bucket,storage_path FROM media_variants WHERE id=%s",
            (variant["audio_variant_id"],),
        ).fetchone()
        destination = storage.root / bucket / object_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"synthetic-audio-placeholder")
        connection.execute(
            "UPDATE media_variants SET size_bytes=%s WHERE id=%s",
            (destination.stat().st_size, variant["audio_variant_id"]),
        )

    class FakeRunner:
        async def detect(self, *args, **kwargs):
            del args, kwargs
            return (
                "silence_start: 0\n"
                "silence_end: 0.6 | silence_duration: 0.6"
            )

    handler = SilenceAnalysisJobHandler(
        config=TranscriptAnalysisConfig(
            handlers_enabled=True,
            temp_root=tmp_path / "work",
            storage_backend="local",
            maximum_source_bytes=10_000_000,
        ),
        storage=storage,
        repository=TranscriptAnalysisRepository(DurableDatabase(DATABASE_URL)),
        runner=FakeRunner(),
    )
    result = _run(handler.execute(_claim(target["job"]["id"]), target["job"]["input"]))
    assert result.finalized
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            "SELECT status,document FROM transcript_analyses WHERE id=%s",
            (target["analysis"]["id"],),
        ).fetchone()
        assert row[0] == "ready"
        assert row[1]["summary"]["intervalCount"] == 1
        assert connection.execute(
            "SELECT count(*) FROM timeline_recommendations WHERE analysis_id=%s",
            (target["analysis"]["id"],),
        ).fetchone()[0] >= 1
