import asyncio
import json
import os
import selectors
from pathlib import Path
from uuid import uuid4

import pytest

psycopg = pytest.importorskip("psycopg")

from backend.contracts.transcript_document_v2 import TranscriptDocumentV2
from server.clipping_orchestration.contracts import (
    CanvasInput,
    ConversionRequest,
    CreateProjectRequest,
    DeriveRequest,
    DraftRequest,
    RecommendationDecisionRequest,
    UpdateProjectRequest,
)
from server.clipping_orchestration.errors import OrchestrationError
from server.clipping_orchestration.repository import ClippingOrchestrationRepository
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.models import AuthenticatedActor

ROOT = Path(__file__).parents[2]
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
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
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
        (21, "clipping_project_orchestration"),
        (22, "clipping_runtime_results"),
        (23, "capinsta_project_handoffs"),
        (24, "clipping_preview_exports"),
    )
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        if "test" not in connection.execute("SELECT current_database()").fetchone()[0].lower():
            raise RuntimeError("Refusing to reset a non-test database")
        connection.execute(bootstrap)
        for index, name in names:
            connection.execute(
                (ROOT / f"apps/web/migrations/{index:04d}_{name}.sql").read_text("utf-8")
            )


def _seed(owner=None):
    owner = owner or uuid4()
    asset = uuid4()
    raw = json.loads(
        (ROOT / "contracts/fixtures/transcript-document-v2/low-confidence.json").read_text("utf-8")
    )
    raw["mediaId"] = str(asset)
    raw["transcriptId"] = f"tr_{str(owner).replace('-', '')[:24]}"
    raw["durationMs"] = 60_000
    raw["segments"][0]["endMs"] = 60_000
    transcript = TranscriptDocumentV2.model_validate(raw)
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id,email) VALUES (%s,%s)", (owner, f"{owner}@example.invalid"))
        connection.execute(
            """INSERT INTO media_assets(
            id,owner_user_id,display_name,mime_type,media_kind,source_type,duration_ms,
            size_bytes,storage_bucket,storage_path,storage_object_revision,status,metadata,revision
            ) VALUES (%s,%s,'source.mp4','video/mp4','video','uploaded',60000,100,
            'source-media',%s,1,'ready','{}',3)""",
            (asset, owner, f"{owner}/{asset}/source/v1.mp4"),
        )
        connection.execute(
            """INSERT INTO transcripts(
            id,owner_user_id,media_asset_id,schema_version,language_mode,duration_ms,
            status,revision,document,quality,metadata,media_revision,
            storage_object_revision,audio_variant_id,audio_variant_revision,
            request_identity,result_identity,ready_at
            ) VALUES (%s,%s,%s,2,%s,60000,'ready',1,%s,%s,'{}',
            NULL,NULL,NULL,NULL,NULL,NULL,now())""",
            (
                transcript.transcriptId, owner, asset, transcript.languageMode,
                json.dumps(transcript.model_dump(mode="json")),
                json.dumps(transcript.quality.model_dump(mode="json")),
            ),
        )
    return AuthenticatedActor(owner), asset, transcript


def _create(repository, actor, asset, transcript, key="create-key"):
    return _run(
        repository.create_project(
            actor,
            CreateProjectRequest(
                mediaAssetId=asset,
                transcriptId=transcript.transcriptId,
                name="Project",
                canvas=CanvasInput(aspectRatio="9:16", width=1080, height=1920),
            ),
            idempotency_key=key,
            maximum_ranges=500,
        )
    )


def _insert_recommendation(actor, asset, transcript, project_id, *, rec_id="rec_silence", start=10_000, end=12_000):
    analysis_id = f"analysis_{rec_id[4:]}"
    recommendation = {
        "schemaVersion": 1,
        "recommendationId": rec_id,
        "analysisId": analysis_id,
        "recommendationType": "remove_silence",
        "sourceStartMs": start,
        "sourceEndMs": end,
        "wordIds": [],
        "segmentIds": [],
        "reasonCode": "silence_exceeds_threshold",
        "severity": "suggestion",
        "analysisConfidence": None,
        "proposedAction": {
            "action": "exclude_source_interval",
            "paddingBeforeMs": 100,
            "paddingAfterMs": 100,
        },
        "contributingFindingIds": [],
        "metadata": {},
    }
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """INSERT INTO transcript_analyses(
            id,owner_user_id,media_asset_id,transcript_id,transcript_revision,
            media_revision,analysis_type,schema_version,analysis_spec,
            analysis_spec_hash,status,document,summary,result_identity,ready_at
            ) VALUES (%s,%s,%s,%s,1,3,'transcript_review',1,'{}',%s,'ready',
            '{}'::jsonb,'{}'::jsonb,%s,now())""",
            (analysis_id, actor.user_id, asset, transcript.transcriptId, "a" * 64, "b" * 64),
        )
        connection.execute(
            """INSERT INTO timeline_recommendations(
            id,owner_user_id,analysis_id,media_asset_id,transcript_id,
            recommendation_type,source_start_ms,source_end_ms,reason_code,
            severity,recommendation,status
            ) VALUES (%s,%s,%s,%s,%s,'remove_silence',%s,%s,
            'silence_exceeds_threshold','suggestion',%s,'proposed')""",
            (
                rec_id, actor.user_id, analysis_id, asset, transcript.transcriptId,
                start, end, json.dumps(recommendation),
            ),
        )
    return rec_id


def test_create_replay_update_versions_and_cache_invalidation():
    _prepare_database()
    actor, asset, transcript = _seed()
    repository = ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL))
    first = _create(repository, actor, asset, transcript)
    second = _create(repository, actor, asset, transcript)
    assert first == second
    assert first["project"]["ranges"][0]["sourceStartMs"] == 0
    assert first["project"]["ranges"][0]["sourceEndMs"] == 60_000
    with pytest.raises(OrchestrationError) as conflict:
        _run(
            repository.create_project(
                actor,
                CreateProjectRequest(
                    mediaAssetId=asset, transcriptId=transcript.transcriptId,
                    name="Different",
                    canvas=CanvasInput(aspectRatio="9:16", width=1080, height=1920),
                ),
                idempotency_key="create-key", maximum_ranges=500,
            )
        )
    assert conflict.value.code == "idempotency_conflict"
    project_id = first["project"]["clipProjectId"]
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """UPDATE clip_projects SET latest_edl='{}',latest_edl_revision=1,
            latest_remapped_transcript='{}',latest_remapped_transcript_revision=1,
            latest_conversion_result='{}',latest_conversion_revision=1 WHERE id=%s""",
            (project_id,),
        )
    updated = _run(
        repository.update_project(
            actor, project_id,
            UpdateProjectRequest(expectedRevision=1, name="Updated"),
            idempotency_key="update-key", maximum_ranges=500,
        )
    )
    assert updated["revision"] == 2
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            """SELECT latest_edl,latest_remapped_transcript,
            latest_conversion_result FROM clip_projects WHERE id=%s""",
            (project_id,),
        ).fetchone()
        assert row == (None, None, None)
        assert connection.execute(
            "SELECT count(*) FROM clip_project_versions WHERE clip_project_id=%s",
            (project_id,),
        ).fetchone()[0] == 2


def test_end_to_end_decision_and_draft_provenance():
    _prepare_database()
    actor, asset, transcript = _seed()
    repository = ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL))
    created = _create(repository, actor, asset, transcript)
    project_id = created["project"]["clipProjectId"]
    rec_id = _insert_recommendation(actor, asset, transcript, project_id)
    original_analysis = None
    with psycopg.connect(DATABASE_URL) as connection:
        original_analysis = connection.execute(
            "SELECT document FROM transcript_analyses"
        ).fetchone()[0]
    decision = RecommendationDecisionRequest(
        expectedProjectRevision=1,
        decisions=[{"recommendationId": rec_id, "decision": "accepted"}],
        note="Reviewed",
    )
    _run(
        repository.decide(
            actor, project_id, decision,
            idempotency_key="decision-key", request_id="request-1",
        )
    )
    draft = _run(
        repository.derive_draft(
            actor, project_id,
            DraftRequest(expectedProjectRevision=1, draftName="Accepted draft"),
            idempotency_key="draft-key",
        )
    )
    assert draft["revision"] == 2
    assert [(item["sourceStartMs"], item["sourceEndMs"]) for item in draft["project"]["ranges"]] == [
        (0, 10_000), (12_000, 60_000)
    ]
    with psycopg.connect(DATABASE_URL) as connection:
        recommendation = connection.execute(
            """SELECT status,decided_by,decided_at,decision_note,
            decision_request_id FROM timeline_recommendations WHERE id=%s""",
            (rec_id,),
        ).fetchone()
        assert recommendation[0] == "accepted"
        assert recommendation[1] == actor.user_id
        assert recommendation[2] is not None
        assert recommendation[3:] == ("Reviewed", "request-1")
        version = connection.execute(
            """SELECT version_source,derivation_identity FROM clip_project_versions
            WHERE clip_project_id=%s AND revision=2""",
            (project_id,),
        ).fetchone()
        assert version[0] == "accepted_recommendations"
        assert version[1] == draft["derivationIdentity"]
        assert connection.execute(
            "SELECT count(*) FROM clip_project_recommendation_consumptions"
        ).fetchone()[0] == 1
        project = connection.execute(
            "SELECT latest_edl,latest_remapped_transcript FROM clip_projects WHERE id=%s",
            (project_id,),
        ).fetchone()
        assert project == (None, None)
        assert connection.execute("SELECT document FROM transcript_analyses").fetchone()[0] == original_analysis


def test_conflicting_concurrent_decisions_are_atomic():
    _prepare_database()
    actor, asset, transcript = _seed()
    repository = ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL))
    project_id = _create(repository, actor, asset, transcript)["project"]["clipProjectId"]
    rec_id = _insert_recommendation(actor, asset, transcript, project_id)

    async def decide(value, key):
        try:
            return await repository.decide(
                actor, project_id,
                RecommendationDecisionRequest(
                    expectedProjectRevision=1,
                    decisions=[{"recommendationId": rec_id, "decision": value}],
                ),
                idempotency_key=key, request_id=key,
            )
        except OrchestrationError as exc:
            return exc.code

    async def concurrent():
        return await asyncio.gather(
            decide("accepted", "accept-key"), decide("rejected", "reject-key")
        )

    results = _run(concurrent())
    assert sum(isinstance(item, dict) for item in results) == 1
    assert "recommendation_decision_conflict" in results


def test_concurrent_identical_draft_creates_one_revision():
    _prepare_database()
    actor, asset, transcript = _seed()
    repository = ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL))
    project_id = _create(repository, actor, asset, transcript)["project"]["clipProjectId"]
    rec_id = _insert_recommendation(actor, asset, transcript, project_id)
    _run(
        repository.decide(
            actor, project_id,
            RecommendationDecisionRequest(
                expectedProjectRevision=1,
                decisions=[{"recommendationId": rec_id, "decision": "accepted"}],
            ),
            idempotency_key="decision", request_id="decision",
        )
    )
    request = DraftRequest(expectedProjectRevision=1)

    async def concurrent():
        return await asyncio.gather(
            repository.derive_draft(actor, project_id, request, idempotency_key="same-draft"),
            repository.derive_draft(actor, project_id, request, idempotency_key="same-draft"),
        )

    first, second = _run(concurrent())
    assert first == second
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute(
            "SELECT revision FROM clip_projects WHERE id=%s", (project_id,)
        ).fetchone()[0] == 2
        assert connection.execute(
            "SELECT count(*) FROM clip_project_versions WHERE clip_project_id=%s",
            (project_id,),
        ).fetchone()[0] == 2


def test_draft_atomic_rollback_on_provenance_failure():
    _prepare_database()
    actor, asset, transcript = _seed()
    repository = ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL))
    project_id = _create(repository, actor, asset, transcript)["project"]["clipProjectId"]
    rec_id = _insert_recommendation(actor, asset, transcript, project_id)
    _run(
        repository.decide(
            actor, project_id,
            RecommendationDecisionRequest(
                expectedProjectRevision=1,
                decisions=[{"recommendationId": rec_id, "decision": "accepted"}],
            ),
            idempotency_key="decision", request_id="decision",
        )
    )
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """CREATE FUNCTION reject_consumption() RETURNS trigger LANGUAGE plpgsql
            AS $$ BEGIN RAISE EXCEPTION 'forced rollback'; END $$"""
        )
        connection.execute(
            """CREATE TRIGGER reject_consumption BEFORE INSERT ON
            clip_project_recommendation_consumptions FOR EACH ROW
            EXECUTE FUNCTION reject_consumption()"""
        )
    with pytest.raises(Exception):
        _run(
            repository.derive_draft(
                actor, project_id, DraftRequest(expectedProjectRevision=1),
                idempotency_key="draft",
            )
        )
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute(
            "SELECT revision FROM clip_projects WHERE id=%s", (project_id,)
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT count(*) FROM clip_project_versions WHERE clip_project_id=%s",
            (project_id,),
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT count(*) FROM clip_project_recommendation_consumptions"
        ).fetchone()[0] == 0


def test_revision_bound_derivation_and_conversion_jobs():
    _prepare_database()
    actor, asset, transcript = _seed()
    repository = ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL))
    project_id = _create(repository, actor, asset, transcript)["project"]["clipProjectId"]
    derived = _run(
        repository.request_derivation(
            actor, project_id, DeriveRequest(expectedRevision=1),
            idempotency_key="derive",
        )
    )
    assert derived["status"] == "queued"
    assert derived == _run(
        repository.request_derivation(
            actor, project_id, DeriveRequest(expectedRevision=1),
            idempotency_key="derive",
        )
    )
    with pytest.raises(OrchestrationError) as missing:
        _run(
            repository.request_conversion(
                actor, project_id,
                ConversionRequest(
                    expectedRevision=1, targetProjectId="capinsta_target",
                    includeCaptions=False,
                ),
                idempotency_key="conversion",
            )
        )
    assert missing.value.code == "derived_data_missing"
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """UPDATE clip_projects SET latest_edl='{}',
            latest_edl_revision=1,latest_derivation_transcript_revision=1,
            latest_derivation_result_identity=%s WHERE id=%s""",
            ("e" * 64, project_id),
        )
    conversion = _run(
        repository.request_conversion(
            actor, project_id,
            ConversionRequest(
                expectedRevision=1, targetProjectId="capinsta_target",
                includeCaptions=False,
            ),
            idempotency_key="conversion-ready",
        )
    )
    assert conversion["status"] == "queued"
    with psycopg.connect(DATABASE_URL) as connection:
        types = {
            row[0] for row in connection.execute(
                "SELECT job_type FROM processing_jobs WHERE project_id=%s", (project_id,)
            )
        }
        assert types == {"project_derivation", "project_conversion"}


def test_two_user_rls_and_browser_write_denial():
    _prepare_database()
    actor_a, asset_a, transcript_a = _seed()
    repository = ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL))
    project_id = _create(repository, actor_a, asset_a, transcript_a)["project"]["clipProjectId"]
    rec_id = _insert_recommendation(actor_a, asset_a, transcript_a, project_id)
    actor_b, _, _ = _seed()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute("SELECT set_config('request.jwt.claim.sub',%s,false)", (str(actor_a.user_id),))
        assert connection.execute("SELECT count(*) FROM clip_projects").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM timeline_recommendations").fetchone()[0] == 1
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("UPDATE timeline_recommendations SET status='accepted' WHERE id=%s", (rec_id,))
        connection.execute("RESET ROLE")
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute("SELECT set_config('request.jwt.claim.sub',%s,false)", (str(actor_b.user_id),))
        assert connection.execute("SELECT count(*) FROM clip_projects").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM timeline_recommendations").fetchone()[0] == 0
