import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

import pytest

psycopg = pytest.importorskip("psycopg")

from server.automatic_clipper.repository import AutomaticClipperRepository
from server.automatic_clipper.contracts import CandidateSelectionRequestV1
from server.clipping_orchestration.repository import ClippingOrchestrationRepository
from server.clipping_persistence.database import DurableDatabase

from test_clipping_orchestration_postgres import (
    _create,
    _prepare_database,
    _run,
    _seed,
)

ROOT = Path(__file__).parents[2]
DATABASE_URL = os.getenv("CLIPPING_PERSISTENCE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="Disposable PostgreSQL 17 test URL required"
)


def _prepare():
    _prepare_database()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            (ROOT / "apps/web/migrations/0025_automatic_clipper.sql").read_text(
                "utf-8"
            )
        )


def test_candidate_planning_is_concurrent_idempotent_and_revision_bound():
    _prepare()
    actor, asset, transcript = _seed()
    project = _create(
        ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL)),
        actor,
        asset,
        transcript,
    )
    repository = AutomaticClipperRepository(DurableDatabase(DATABASE_URL))
    project_id = project["project"]["clipProjectId"]

    async def concurrent():
        return await asyncio.gather(
            repository.plan_candidates(
                actor, project_id, expected_revision=1
            ),
            repository.plan_candidates(
                actor, project_id, expected_revision=1
            ),
        )

    first, second = _run(concurrent())
    assert first["analysisId"] == second["analysisId"]
    assert first["jobId"] == second["jobId"]
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute(
            "SELECT count(*) FROM transcript_analyses WHERE analysis_type='viral_candidates'"
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT count(*) FROM processing_jobs WHERE job_type='viral_candidate_analysis'"
        ).fetchone()[0] == 1
    with pytest.raises(Exception) as stale:
        _run(
            repository.plan_candidates(
                actor, project_id, expected_revision=2
            )
        )
    assert getattr(stale.value, "code", None) == "project_revision_conflict"

    regenerated = _run(
        repository.plan_candidates(
            actor,
            project_id,
            expected_revision=1,
            regeneration_key="regenerate-a",
        )
    )
    replay = _run(
        repository.plan_candidates(
            actor,
            project_id,
            expected_revision=1,
            regeneration_key="regenerate-a",
        )
    )
    replacement = _run(
        repository.plan_candidates(
            actor,
            project_id,
            expected_revision=1,
            regeneration_key="regenerate-b",
        )
    )
    assert regenerated["analysisId"] == replay["analysisId"]
    assert regenerated["jobId"] == replay["jobId"]
    assert replacement["analysisId"] != regenerated["analysisId"]


def test_candidate_selection_is_atomic_and_idempotent():
    _prepare()
    actor, asset, transcript = _seed()
    project = _create(
        ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL)),
        actor,
        asset,
        transcript,
    )
    repository = AutomaticClipperRepository(DurableDatabase(DATABASE_URL))
    project_id = project["project"]["clipProjectId"]
    analysis = _run(
        repository.plan_candidates(actor, project_id, expected_revision=1)
    )
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """INSERT INTO clip_candidates(
            id,owner_user_id,clip_project_id,analysis_id,media_asset_id,
            media_revision,transcript_id,transcript_revision,project_revision,candidate)
            VALUES('candidate_select',%s,%s,%s,%s,3,%s,1,1,%s)""",
            (
                actor.user_id,
                project_id,
                analysis["analysisId"],
                asset,
                transcript.transcriptId,
                json.dumps(
                    {
                        "candidateId": "candidate_select",
                        "sourceStartMs": 0,
                        "sourceEndMs": 1_000,
                    }
                ),
            ),
        )
    request = CandidateSelectionRequestV1(expectedRevision=1)

    async def concurrent():
        return await asyncio.gather(
            repository.queue_selection(
                actor, project_id, "candidate_select", request
            ),
            repository.queue_selection(
                actor, project_id, "candidate_select", request
            ),
        )

    first, second = _run(concurrent())
    assert first["jobId"] == second["jobId"]
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute(
            """SELECT count(*) FROM processing_jobs
            WHERE job_type='smart_reframe'"""
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT revision FROM clip_projects WHERE id=%s", (project_id,)
        ).fetchone()[0] == 1


def test_candidate_rls_owner_isolation_anonymous_denial_and_browser_write_denial():
    _prepare()
    actor, asset, transcript = _seed()
    project = _create(
        ClippingOrchestrationRepository(DurableDatabase(DATABASE_URL)),
        actor,
        asset,
        transcript,
    )
    other = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "INSERT INTO auth.users(id,email) VALUES(%s,%s)",
            (other, f"{other}@example.invalid"),
        )
        project_id = project["project"]["clipProjectId"]
        analysis_id = "analysis_rls_fixture"
        connection.execute(
            """INSERT INTO transcript_analyses(
            id,owner_user_id,media_asset_id,transcript_id,transcript_revision,
            media_revision,analysis_type,schema_version,analysis_spec,
            analysis_spec_hash,status)
            VALUES(%s,%s,%s,%s,1,3,'viral_candidates',1,'{}',%s,'queued')""",
            (
                analysis_id,
                actor.user_id,
                asset,
                transcript.transcriptId,
                "a" * 64,
            ),
        )
        connection.execute(
            """INSERT INTO clip_candidates(
            id,owner_user_id,clip_project_id,analysis_id,media_asset_id,
            media_revision,transcript_id,transcript_revision,project_revision,candidate)
            VALUES('candidate_rls',%s,%s,%s,%s,3,%s,1,1,%s)""",
            (
                actor.user_id,
                project_id,
                analysis_id,
                asset,
                transcript.transcriptId,
                json.dumps({"candidateId": "candidate_rls", "viralScore": 50}),
            ),
        )
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,false)", (str(other),)
        )
        assert connection.execute("SELECT count(*) FROM clip_candidates").fetchone()[0] == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                """INSERT INTO clip_candidates(
                id,owner_user_id,clip_project_id,analysis_id,media_asset_id,
                media_revision,transcript_id,transcript_revision,project_revision,candidate)
                VALUES('browser_write',%s,%s,%s,%s,3,%s,1,1,'{}')""",
                (
                    other,
                    project_id,
                    analysis_id,
                    asset,
                    transcript.transcriptId,
                ),
            )
        connection.execute("RESET ROLE")
        connection.execute("SET ROLE anon")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("SELECT count(*) FROM clip_candidates")
