import asyncio
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

import pytest

import test_clipping_orchestration_postgres as base
from server.clipping_handoff.config import HandoffConfig
from server.clipping_handoff.contracts import (
    CompleteHandoffRequestV1,
    PrepareHandoffRequestV1,
)
from server.clipping_handoff.errors import HandoffError
from server.clipping_handoff.repository import HandoffRepository
from server.clipping_orchestration.repository import ClippingOrchestrationRepository
from server.clipping_persistence.database import DurableDatabase
from server.clipping_persistence.errors import PersistenceError

DATABASE_URL = os.getenv("CLIPPING_PERSISTENCE_TEST_DATABASE_URL")
ROOT = Path(__file__).parents[2]
pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="Disposable PostgreSQL 17 test URL required"
)


def _config():
    return HandoffConfig(
        enabled=True,
        server_backed_media_enabled=True,
        ttl_seconds=900,
        maximum_manifest_bytes=64 * 1024 * 1024,
    )


async def _seed_current_conversion():
    actor, asset, transcript = base._seed()
    database = DurableDatabase(DATABASE_URL)
    orchestration = ClippingOrchestrationRepository(database)
    created = await orchestration.create_project(
        actor,
        base.CreateProjectRequest(
            mediaAssetId=asset,
            transcriptId=transcript.transcriptId,
            name="Handoff project",
            canvas=base.CanvasInput(
                aspectRatio="9:16", width=1080, height=1920
            ),
        ),
        idempotency_key=f"handoff-create-{uuid4()}",
        maximum_ranges=500,
    )
    project_id = created["project"]["clipProjectId"]
    conversion = json.loads(
        (
            ROOT
            / "contracts/fixtures/clipping-runtime-v1/responses/convert-without-captions.json"
        ).read_text("utf-8")
    )["result"]
    target = f"capinsta_{uuid4().hex}"
    media_id = str(asset)
    conversion["sourceClipProjectId"] = project_id
    conversion["targetProjectId"] = target
    conversion["mediaReference"]["mediaId"] = media_id
    conversion["mediaReference"]["sourceAssetId"] = media_id
    conversion["mapping"]["sourceMediaId"] = media_id
    conversion["mapping"]["capinstaMediaId"] = media_id
    conversion["project"]["metadata"]["id"] = target
    conversion["project"]["capinstaClippingProvenance"][
        "sourceClipProjectId"
    ] = project_id
    conversion["project"]["scenes"][0]["tracks"]["main"]["elements"][0][
        "mediaId"
    ] = media_id
    identity = "c" * 64
    with base.psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """UPDATE clip_projects SET latest_conversion_result=%s,
            latest_conversion_revision=revision,
            latest_conversion_result_identity=%s WHERE id=%s""",
            (json.dumps(conversion), identity, project_id),
        )
    return database, actor, project_id, target, identity, asset


def test_prepare_claim_complete_replay_and_private_manifest_boundary():
    base._prepare_database()

    async def scenario():
        database, actor, project_id, target, identity, asset = (
            await _seed_current_conversion()
        )
        repository = HandoffRepository(database, _config())
        request = PrepareHandoffRequestV1(
            expectedRevision=1,
            targetProjectId=target,
            options={"includeCaptions": False},
        )
        prepared = await repository.prepare(
            actor, project_id, request, idempotency_key="handoff-prepare"
        )
        replay = await repository.prepare(
            actor, project_id, request, idempotency_key="handoff-prepare"
        )
        assert replay == prepared
        handoff_id = UUID(prepared["handoffId"])
        claimed = await repository.claim(actor, handoff_id)
        manifest = claimed["handoff"]
        assert manifest["conversionResultIdentity"] == identity
        assert manifest["mediaAttachments"][0]["mediaId"] == str(asset)
        serialized = json.dumps(manifest).lower()
        assert "signedurl" not in serialized
        assert "storagepath" not in serialized
        assert "localpath" not in serialized
        completed = await repository.complete(
            actor,
            handoff_id,
            CompleteHandoffRequestV1(
                importedProjectId=target, importedProjectRevision=1
            ),
        )
        replayed = await repository.complete(
            actor,
            handoff_id,
            CompleteHandoffRequestV1(
                importedProjectId=target, importedProjectRevision=1
            ),
        )
        assert completed["status"] == "imported"
        assert replayed["replayed"] is True
        # A redirect/network retry can claim the imported handoff and reopen safely.
        assert (await repository.claim(actor, handoff_id))["claim"]["status"] == (
            "imported"
        )
        return handoff_id, actor

    handoff_id, owner = base._run(scenario())
    with base.psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        foreign = uuid4()
        connection.execute(
            "INSERT INTO auth.users(id,email) VALUES (%s,%s)",
            (foreign, f"{foreign}@example.invalid"),
        )
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,false)", (str(foreign),)
        )
        assert (
            connection.execute(
                "SELECT id FROM project_handoffs WHERE id=%s", (handoff_id,)
            ).fetchone()
            is None
        )
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,false)", (str(owner.user_id),)
        )
        row = connection.execute(
            """SELECT id,status,target_project_id,completed_at
            FROM project_handoffs WHERE id=%s""",
            (handoff_id,),
        ).fetchone()
        assert row[1] == "imported"


def test_stale_conversion_and_foreign_claim_are_rejected():
    base._prepare_database()

    async def scenario():
        database, actor, project_id, target, _, _ = (
            await _seed_current_conversion()
        )
        repository = HandoffRepository(database, _config())
        prepared = await repository.prepare(
            actor,
            project_id,
            PrepareHandoffRequestV1(
                expectedRevision=1, targetProjectId=target
            ),
            idempotency_key="handoff-stale",
        )
        handoff_id = UUID(prepared["handoffId"])
        foreign_actor, _, _ = base._seed()
        with pytest.raises(HandoffError) as foreign:
            await repository.claim(foreign_actor, handoff_id)
        assert foreign.value.code == "handoff_not_found"
        with base.psycopg.connect(
            DATABASE_URL, autocommit=True
        ) as connection:
            connection.execute(
                """UPDATE clip_projects SET revision=revision+1,
                project=jsonb_set(project,'{revision}',to_jsonb(revision+1))
                WHERE id=%s""",
                (project_id,),
            )
        with pytest.raises(HandoffError) as stale:
            await repository.claim(actor, handoff_id)
        assert stale.value.code == "handoff_conversion_stale"

    base._run(scenario())


def test_concurrent_equivalent_prepare_and_claim_collapse_to_one_handoff():
    base._prepare_database()

    async def scenario():
        database, actor, project_id, target, _, _ = (
            await _seed_current_conversion()
        )
        request = PrepareHandoffRequestV1(
            expectedRevision=1,
            targetProjectId=target,
            options={"includeCaptions": False},
        )
        first, second = await asyncio.gather(
            HandoffRepository(database, _config()).prepare(
                actor, project_id, request, idempotency_key="concurrent-a"
            ),
            HandoffRepository(database, _config()).prepare(
                actor, project_id, request, idempotency_key="concurrent-b"
            ),
        )
        assert first["handoffId"] == second["handoffId"]
        handoff_id = UUID(first["handoffId"])
        claims = await asyncio.gather(
            HandoffRepository(database, _config()).claim(actor, handoff_id),
            HandoffRepository(database, _config()).claim(actor, handoff_id),
        )
        assert {item["claim"]["status"] for item in claims} == {"claimed"}
        return handoff_id

    handoff_id = base._run(scenario())
    with base.psycopg.connect(DATABASE_URL) as connection:
        count = connection.execute(
            "SELECT count(*) FROM project_handoffs WHERE id=%s", (handoff_id,)
        ).fetchone()[0]
        assert count == 1


def test_migration_structure_and_rls_access_boundary():
    base._prepare_database()

    async def scenario():
        database, actor, project_id, target, _, _ = (
            await _seed_current_conversion()
        )
        prepared = await HandoffRepository(database, _config()).prepare(
            actor,
            project_id,
            PrepareHandoffRequestV1(
                expectedRevision=1, targetProjectId=target
            ),
            idempotency_key="handoff-rls",
        )
        return UUID(prepared["handoffId"]), actor

    handoff_id, owner = base._run(scenario())
    with base.psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        columns = {
            row[0]
            for row in connection.execute(
                """SELECT column_name FROM information_schema.columns
                WHERE table_schema='public' AND table_name='project_handoffs'"""
            )
        }
        assert {
            "id",
            "owner_user_id",
            "clip_project_id",
            "clip_project_revision",
            "conversion_result_identity",
            "target_project_id",
            "status",
            "manifest_schema_version",
            "manifest",
            "request_identity",
            "expires_at",
            "claimed_at",
            "claimed_by",
            "imported_project_id",
            "imported_project_revision",
            "completed_at",
            "failure",
            "revision",
            "created_at",
            "updated_at",
        } <= columns
        constraints = {
            row[0]
            for row in connection.execute(
                """SELECT conname FROM pg_constraint
                WHERE conrelid='project_handoffs'::regclass"""
            )
        }
        assert {
            "project_handoffs_identity_check",
            "project_handoffs_schema_check",
            "project_handoffs_manifest_identity_check",
            "project_handoffs_status_check",
            "project_handoffs_expiry_check",
        } <= constraints
        indexes = {
            row[0]
            for row in connection.execute(
                """SELECT indexname FROM pg_indexes
                WHERE schemaname='public' AND tablename='project_handoffs'"""
            )
        }
        assert {
            "project_handoffs_pkey",
            "project_handoffs_owner_created_idx",
            "project_handoffs_project_revision_idx",
            "project_handoffs_expiry_idx",
            "project_handoffs_active_identity_key",
        } <= indexes
        assert connection.execute(
            """SELECT relrowsecurity FROM pg_class
            WHERE oid='project_handoffs'::regclass"""
        ).fetchone()[0] is True
        assert connection.execute(
            """SELECT count(*) FROM pg_trigger
            WHERE tgrelid='project_handoffs'::regclass
            AND tgname='project_handoffs_identity_trigger'
            AND NOT tgisinternal"""
        ).fetchone()[0] == 1

        connection.execute("SET ROLE anon")
        with pytest.raises(base.psycopg.errors.InsufficientPrivilege):
            connection.execute("SELECT id FROM project_handoffs")
        connection.execute("RESET ROLE")

        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,false)",
            (str(owner.user_id),),
        )
        assert connection.execute(
            "SELECT id FROM project_handoffs WHERE id=%s", (handoff_id,)
        ).fetchone()[0] == handoff_id
        with pytest.raises(base.psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "SELECT manifest FROM project_handoffs WHERE id=%s",
                (handoff_id,),
            )
        with pytest.raises(base.psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "UPDATE project_handoffs SET status='cancelled' WHERE id=%s",
                (handoff_id,),
            )
        connection.execute("RESET ROLE")


def test_expiry_stale_prepare_and_trusted_cancel():
    base._prepare_database()

    async def scenario():
        database, actor, project_id, target, _, _ = (
            await _seed_current_conversion()
        )
        repository = HandoffRepository(database, _config())
        request = PrepareHandoffRequestV1(
            expectedRevision=1, targetProjectId=target
        )
        prepared = await repository.prepare(
            actor,
            project_id,
            request,
            idempotency_key="handoff-cancel",
        )
        cancelled = await repository.cancel(
            actor, UUID(prepared["handoffId"])
        )
        assert cancelled["status"] == "cancelled"

        expiring = await repository.prepare(
            actor,
            project_id,
            request,
            idempotency_key="handoff-expiry",
        )
        expired_id = UUID(expiring["handoffId"])
        with base.psycopg.connect(
            DATABASE_URL, autocommit=True
        ) as connection:
            connection.execute(
                """UPDATE project_handoffs
                SET created_at=now()-interval '2 hours',
                    expires_at=now()-interval '1 hour'
                WHERE id=%s""",
                (expired_id,),
            )
        with pytest.raises(HandoffError) as expired:
            await repository.claim(actor, expired_id)
        assert expired.value.code == "handoff_expired"

        with base.psycopg.connect(
            DATABASE_URL, autocommit=True
        ) as connection:
            connection.execute(
                """UPDATE clip_projects SET revision=revision+1,
                project=jsonb_set(project,'{revision}',to_jsonb(revision+1))
                WHERE id=%s""",
                (project_id,),
            )
        with pytest.raises(HandoffError) as stale:
            await repository.prepare(
                actor,
                project_id,
                PrepareHandoffRequestV1(
                    expectedRevision=2, targetProjectId=target
                ),
                idempotency_key="handoff-stale-prepare",
            )
        assert stale.value.code == "handoff_conversion_stale"

    base._run(scenario())


def test_prepare_rolls_back_handoff_and_idempotency_together():
    base._prepare_database()

    async def scenario():
        database, actor, project_id, target, _, _ = (
            await _seed_current_conversion()
        )
        with base.psycopg.connect(
            DATABASE_URL, autocommit=True
        ) as connection:
            connection.execute(
                """CREATE FUNCTION reject_handoff_idempotency_completion()
                RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF NEW.resource_type='project_handoff' THEN
                    RAISE EXCEPTION 'forced handoff rollback';
                  END IF;
                  RETURN NEW;
                END $$"""
            )
            connection.execute(
                """CREATE TRIGGER reject_handoff_idempotency_completion
                BEFORE UPDATE ON idempotency_records FOR EACH ROW
                EXECUTE FUNCTION reject_handoff_idempotency_completion()"""
            )
        with pytest.raises(PersistenceError) as failure:
            await HandoffRepository(database, _config()).prepare(
                actor,
                project_id,
                PrepareHandoffRequestV1(
                    expectedRevision=1, targetProjectId=target
                ),
                idempotency_key="handoff-forced-rollback",
            )
        assert failure.value.category == "transaction_failed"
        with base.psycopg.connect(DATABASE_URL) as connection:
            assert connection.execute(
                "SELECT count(*) FROM project_handoffs"
            ).fetchone()[0] == 0
            assert connection.execute(
                """SELECT count(*) FROM idempotency_records
                WHERE idempotency_key='handoff-forced-rollback'"""
            ).fetchone()[0] == 0

    base._run(scenario())
