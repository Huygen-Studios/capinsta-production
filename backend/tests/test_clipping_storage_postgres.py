import asyncio
import os
import selectors
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest

psycopg = pytest.importorskip("psycopg")

from server.clipping_persistence import AuthenticatedActor, DurableDatabase
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.errors import StorageError
from server.clipping_storage.models import (
    StorageObjectMetadata,
    UploadAuthorization,
)
from server.clipping_storage.repository import MediaStorageRepository
from server.clipping_storage.services import (
    MediaAccessService,
    MediaDeletionService,
    MediaUploadService,
)
from server.clipping_storage.storage import MediaStorage

ROOT = Path(__file__).resolve().parents[2]
DATABASE_URL = os.getenv("CLIPPING_PERSISTENCE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="Disposable PostgreSQL test URL required"
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
    storage_schema = """
      CREATE SCHEMA storage;
      GRANT USAGE ON SCHEMA storage TO authenticated,anon,service_role;
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        public boolean NOT NULL DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      CREATE TABLE storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id text NOT NULL REFERENCES storage.buckets(id),
        name text NOT NULL,
        owner_id text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE(bucket_id,name)
      );
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT SELECT,INSERT ON storage.objects TO authenticated;
      GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO service_role;
      GRANT SELECT ON storage.objects TO anon;
    """
    migration_14 = (
        ROOT / "apps/web/migrations/0014_clipping_persistence.sql"
    ).read_text(encoding="utf-8")
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        database_name = connection.execute("SELECT current_database()").fetchone()[0]
        if "test" not in database_name.lower():
            raise RuntimeError("Refusing to reset a non-test database")
        connection.execute(bootstrap)
        connection.execute(migration_14)
        connection.execute(storage_schema)
        for version in range(15, 29):
            migration = next(
                (ROOT / "apps/web/migrations").glob(f"{version:04d}_*.sql")
            ).read_text(encoding="utf-8")
            connection.execute(migration)


class FakeStorage(MediaStorage):
    def __init__(self):
        self.objects = {}
        self.deleted = []
        self.fail_delete = False
        self.fail_authorize = False

    async def create_upload_session(self, *, bucket, path, mime_type):
        if self.fail_authorize:
            raise StorageError("storage_provider_unavailable", "offline")
        return UploadAuthorization(
            protocol="tus",
            upload_url="https://storage.invalid/upload/resumable",
            required_headers={"x-signature": "ephemeral"},
            upload_metadata={
                "bucketName": bucket,
                "objectName": path,
                "contentType": mime_type,
            },
        )

    async def inspect_object(self, *, bucket, path):
        try:
            return self.objects[(bucket, path)]
        except KeyError as exc:
            raise StorageError(
                "object_not_found", "Storage object was not found"
            ) from exc

    async def create_read_url(self, *, bucket, path, expires_in):
        return f"https://storage.invalid/preview?ttl={expires_in}&token=temporary"

    async def create_download_url(
        self, *, bucket, path, expires_in, filename
    ):
        return (
            "https://storage.invalid/download"
            f"?ttl={expires_in}&name={filename}&token=temporary"
        )

    async def delete_object(self, *, bucket, path):
        if self.fail_delete:
            raise StorageError("storage_provider_unavailable", "offline")
        self.deleted.append((bucket, path))
        self.objects.pop((bucket, path), None)

    async def move_object(self, **kwargs):
        raise NotImplementedError

    async def copy_object(self, **kwargs):
        raise NotImplementedError


class FakeR2Storage(FakeStorage):
    def __init__(self):
        super().__init__()
        self.created = 0
        self.listed = 0
        self.aborted = 0

    async def create_upload_session(self, *, bucket, path, mime_type):
        self.created += 1
        await asyncio.sleep(0.02)
        return UploadAuthorization(
            protocol="s3_multipart",
            upload_url=None,
            required_headers={},
            upload_metadata={},
            provider_upload_id="provider-upload-1",
        )

    async def list_multipart_parts(self, **_kwargs):
        self.listed += 1
        return []

    async def abort_multipart_upload(self, **_kwargs):
        self.aborted += 1


def _services():
    database = DurableDatabase(DATABASE_URL)
    repository = MediaStorageRepository(database)
    storage = FakeStorage()
    config = MediaStorageConfig(
        enabled=True,
        supabase_url="https://project.supabase.co",
        service_role_key="test",
        maximum_upload_bytes=1_000,
    )
    return (
        repository,
        storage,
        MediaUploadService(
            config=config, storage=storage, repository=repository
        ),
        MediaAccessService(
            config=config, storage=storage, repository=repository
        ),
        MediaDeletionService(config=config, storage=storage, repository=repository),
    )


def test_private_buckets_and_storage_rls():
    _prepare_database()
    user_a, user_b = uuid4(), uuid4()
    asset_a, asset_b = uuid4(), uuid4()
    session_a, session_a_v2, session_b = uuid4(), uuid4(), uuid4()
    path_a = f"{user_a}/{asset_a}/source/v1.mp4"
    path_a_v2 = f"{user_a}/{asset_a}/source/v2.mp4"
    path_b = f"{user_b}/{asset_b}/source/v1.mp4"
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "INSERT INTO auth.users(id) VALUES (%s),(%s)", (user_a, user_b)
        )
        connection.execute(
            """
            INSERT INTO media_assets(id,owner_user_id,display_name)
            VALUES (%s,%s,'A'),(%s,%s,'B')
            """,
            (asset_a, user_a, asset_b, user_b),
        )
        connection.execute(
            """
            INSERT INTO media_upload_sessions(
              id,owner_user_id,media_asset_id,storage_bucket,storage_path,
              upload_protocol,status,expected_size_bytes,display_name,mime_type,expires_at
            ) VALUES (%s,%s,%s,'source-media',%s,'tus','authorized',10,
              'A.mp4','video/mp4',now()+interval '1 hour')
            """,
            (session_a, user_a, asset_a, path_a),
        )
        connection.execute(
            """
            INSERT INTO media_upload_sessions(
              id,owner_user_id,media_asset_id,storage_bucket,storage_path,
              upload_protocol,status,expected_size_bytes,display_name,mime_type,expires_at
            ) VALUES (%s,%s,%s,'source-media',%s,'tus','authorized',10,
              'A replacement.mp4','video/mp4',now()+interval '1 hour')
            """,
            (session_a_v2, user_a, asset_a, path_a_v2),
        )
        connection.execute(
            """
            INSERT INTO media_upload_sessions(
              id,owner_user_id,media_asset_id,storage_bucket,storage_path,
              upload_protocol,status,expected_size_bytes,display_name,mime_type,expires_at
            ) VALUES (%s,%s,%s,'source-media',%s,'tus','authorized',10,
              'B.mp4','video/mp4',now()+interval '1 hour')
            """,
            (session_b, user_b, asset_b, path_b),
        )
        connection.execute(
            """
            INSERT INTO storage.objects(bucket_id,name)
            VALUES ('source-media',%s),('source-media',%s)
            """,
            (path_a, path_b),
        )
        buckets = connection.execute(
            "SELECT id,public FROM storage.buckets ORDER BY id"
        ).fetchall()
        assert buckets == [
            ("media-exports", False),
            ("media-variants", False),
            ("source-media", False),
        ]

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,true)", (str(user_a),)
        )
        assert connection.execute(
            "SELECT name FROM storage.objects"
        ).fetchall() == [(path_a,)]
        assert connection.execute(
            "SELECT storage_path FROM media_upload_sessions ORDER BY storage_path"
        ).fetchall() == [(path_a,), (path_a_v2,)]
        connection.execute(
            "INSERT INTO storage.objects(bucket_id,name) VALUES ('source-media',%s)",
            (path_a_v2,),
        )
        connection.commit()
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,true)", (str(user_a),)
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "INSERT INTO storage.objects(bucket_id,name) VALUES ('source-media',%s)",
                (path_b,),
            )

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute(
            "SELECT set_config('request.jwt.claim.sub',%s,true)", (str(user_a),)
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                """
                INSERT INTO storage.objects(bucket_id,name)
                VALUES ('media-variants',%s)
                """,
                (path_a,),
            )

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE anon")
        assert connection.execute(
            "SELECT count(*) FROM storage.objects"
        ).fetchone()[0] == 0

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE service_role")
        assert connection.execute(
            "SELECT count(*) FROM storage.objects"
        ).fetchone()[0] == 3


def test_r2_migration_0028_and_atomic_upload_session_creation():
    _prepare_database()
    user_id = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id) VALUES (%s)", (user_id,))
    actor = AuthenticatedActor(user_id)
    repository = MediaStorageRepository(DurableDatabase(DATABASE_URL))
    storage = FakeR2Storage()
    service = MediaUploadService(
        config=MediaStorageConfig(
            enabled=True,
            storage_provider="r2",
            r2_endpoint_url="https://account.r2.cloudflarestorage.com",
            r2_access_key_id="key",
            r2_secret_access_key="secret",
            maximum_upload_bytes=2_147_483_648,
        ),
        storage=storage,
        repository=repository,
    )

    instructions = _run(
        service.create_upload_session(
            actor,
            display_name="video.mp4",
            mime_type="video/mp4",
            size_bytes=70_000_000,
            idempotency_key="postgres-r2-upload",
        )
    )

    assert instructions.provider == "r2"
    assert instructions.uploaded_parts == []
    assert storage.created == 1
    assert storage.listed == 0
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            """
            SELECT storage_provider,provider_upload_id,multipart_upload_id,
              multipart_part_size_bytes,multipart_part_count,multipart_state,
              signed_url_expires_at,aborted_at
            FROM media_upload_sessions WHERE id=%s
            """,
            (instructions.upload_session_id,),
        ).fetchone()
    assert row[:6] == (
        "r2",
        "provider-upload-1",
        "provider-upload-1",
        33_554_432,
        3,
        "created",
    )
    assert row[6] is not None
    assert row[7] is None


def test_r2_missing_live_column_is_rejected_before_provider_call():
    _prepare_database()
    user_id = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id) VALUES (%s)", (user_id,))
        connection.execute(
            "ALTER TABLE media_upload_sessions DROP COLUMN multipart_upload_id CASCADE"
        )
    storage = FakeR2Storage()
    service = MediaUploadService(
        config=MediaStorageConfig(
            enabled=True,
            storage_provider="r2",
            r2_endpoint_url="https://account.r2.cloudflarestorage.com",
            r2_access_key_id="key",
            r2_secret_access_key="secret",
        ),
        storage=storage,
        repository=MediaStorageRepository(DurableDatabase(DATABASE_URL)),
    )

    with pytest.raises(StorageError) as error:
        _run(
            service.create_upload_session(
                AuthenticatedActor(user_id),
                display_name="video.mp4",
                mime_type="video/mp4",
                size_bytes=10,
                idempotency_key="missing-schema",
            )
        )
    assert error.value.category == "storage_schema_outdated"
    assert storage.created == 0


def test_r2_identical_concurrent_requests_create_one_multipart_upload():
    _prepare_database()
    user_id = uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users(id) VALUES (%s)", (user_id,))
    actor = AuthenticatedActor(user_id)
    storage = FakeR2Storage()
    service = MediaUploadService(
        config=MediaStorageConfig(
            enabled=True,
            storage_provider="r2",
            r2_endpoint_url="https://account.r2.cloudflarestorage.com",
            r2_access_key_id="key",
            r2_secret_access_key="secret",
        ),
        storage=storage,
        repository=MediaStorageRepository(DurableDatabase(DATABASE_URL)),
    )

    async def scenario():
        return await asyncio.gather(
            *(
                service.create_upload_session(
                    actor,
                    display_name="video.mp4",
                    mime_type="video/mp4",
                    size_bytes=70_000_000,
                    idempotency_key="same-postgres-key",
                )
                for _ in range(2)
            )
        )

    first, second = _run(scenario())
    assert first.upload_session_id == second.upload_session_id
    assert storage.created == 1
    assert storage.listed == 1
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute(
            "SELECT count(*) FROM media_upload_sessions"
        ).fetchone()[0] == 1


def test_upload_completion_replacement_urls_and_deletion():
    _prepare_database()
    user_a, user_b = uuid4(), uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            "INSERT INTO auth.users(id) VALUES (%s),(%s)", (user_a, user_b)
        )
    actor, other = AuthenticatedActor(user_a), AuthenticatedActor(user_b)
    repository, storage, upload, access, deletion = _services()

    async def scenario():
        with pytest.raises(StorageError) as invalid_mime:
            await upload.create_upload_session(
                actor,
                display_name="bad.exe",
                mime_type="application/octet-stream",
                size_bytes=10,
                idempotency_key="invalid-mime",
            )
        assert invalid_mime.value.category == "upload_mime_mismatch"
        with pytest.raises(StorageError) as oversized:
            await upload.create_upload_session(
                actor,
                display_name="big.mp4",
                mime_type="video/mp4",
                size_bytes=1001,
                idempotency_key="too-large",
            )
        assert oversized.value.category == "upload_size_mismatch"
        storage.fail_authorize = True
        with pytest.raises(StorageError) as unavailable:
            await upload.create_upload_session(
                actor,
                display_name="Retry.mp4",
                mime_type="video/mp4",
                size_bytes=10,
                idempotency_key="provider-retry",
            )
        assert unavailable.value.category == "storage_provider_unavailable"
        storage.fail_authorize = False
        retried_authorization = await upload.create_upload_session(
            actor,
            display_name="Retry.mp4",
            mime_type="video/mp4",
            size_bytes=10,
            idempotency_key="provider-retry",
        )
        assert retried_authorization.replayed is True

        instructions = await upload.create_upload_session(
            actor,
            display_name="Synthetic.mp4",
            mime_type="video/mp4",
            size_bytes=100,
            idempotency_key="initial",
        )
        replay = await upload.create_upload_session(
            actor,
            display_name="Synthetic.mp4",
            mime_type="video/mp4",
            size_bytes=100,
            idempotency_key="initial",
        )
        assert replay.replayed and replay.upload_session_id == instructions.upload_session_id
        with pytest.raises(StorageError) as conflict:
            await upload.create_upload_session(
                actor,
                display_name="Different.mp4",
                mime_type="video/mp4",
                size_bytes=100,
                idempotency_key="initial",
            )
        assert conflict.value.category == "idempotency_conflict"
        expiring = await upload.create_upload_session(
            actor,
            display_name="Expires.mp4",
            mime_type="video/mp4",
            size_bytes=10,
            idempotency_key="expires",
        )
        with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
            connection.execute(
                "UPDATE media_upload_sessions SET expires_at=now()-interval '1 second' WHERE id=%s",
                (expiring.upload_session_id,),
            )
        with pytest.raises(StorageError) as expired:
            await upload.complete_media_upload(actor, expiring.upload_session_id)
        assert expired.value.category == "upload_session_expired"
        with pytest.raises(StorageError) as unauthorized:
            await upload.get_upload_status(other, instructions.upload_session_id)
        assert unauthorized.value.category == "upload_session_not_found"
        with pytest.raises(StorageError) as missing:
            await upload.complete_media_upload(
                actor, instructions.upload_session_id
            )
        assert missing.value.category == "object_not_found"

        session = await repository.get_session(actor, instructions.upload_session_id)
        storage.objects[(session["storage_bucket"], session["storage_path"])] = (
            StorageObjectMetadata(
                bucket=session["storage_bucket"],
                path=session["storage_path"],
                size_bytes=99,
                mime_type="video/mp4",
            )
        )
        with pytest.raises(StorageError) as mismatch:
            await upload.complete_media_upload(
                actor, instructions.upload_session_id
            )
        assert mismatch.value.category == "upload_size_mismatch"
        storage.objects[(session["storage_bucket"], session["storage_path"])] = (
            StorageObjectMetadata(
                bucket=session["storage_bucket"],
                path=session["storage_path"],
                size_bytes=100,
                mime_type="video/mp4",
            )
        )
        attachment = await upload.complete_media_upload(
            actor, instructions.upload_session_id
        )
        assert attachment.status == "ready_for_probe"
        repeated = await upload.complete_media_upload(
            actor, instructions.upload_session_id
        )
        assert repeated.media_asset_id == attachment.media_asset_id
        asset = await repository.get_asset(actor, attachment.media_asset_id)
        assert asset["revision"] == 2
        old_path = asset["storage_path"]

        preview = await access.create_media_preview_url(
            actor, attachment.media_asset_id
        )
        download = await access.create_media_download_url(
            actor, attachment.media_asset_id
        )
        assert preview.disposition == "inline"
        assert download.disposition == "attachment"
        with pytest.raises(StorageError) as ttl:
            await access.create_media_preview_url(
                actor, attachment.media_asset_id, expires_in=3601
            )
        assert ttl.value.category == "signed_url_failed"
        with pytest.raises(StorageError):
            await access.create_media_preview_url(other, attachment.media_asset_id)

        replacement = await upload.create_upload_session(
            actor,
            display_name="Replacement.webm",
            mime_type="video/webm",
            size_bytes=80,
            idempotency_key="replacement",
            replace_media_asset_id=attachment.media_asset_id,
            expected_revision=2,
        )
        replacement_session = await repository.get_session(
            actor, replacement.upload_session_id
        )
        assert (session["storage_bucket"], old_path) in storage.objects
        storage.objects[
            (
                replacement_session["storage_bucket"],
                replacement_session["storage_path"],
            )
        ] = StorageObjectMetadata(
            bucket=replacement_session["storage_bucket"],
            path=replacement_session["storage_path"],
            size_bytes=80,
            mime_type="video/webm",
        )
        replaced = await upload.complete_media_upload(
            actor, replacement.upload_session_id, create_probe_job=False
        )
        assert replaced.storage_path.endswith("/source/v3.webm")
        assert replaced.display_name == "Replacement.webm"
        assert (session["storage_bucket"], old_path) not in storage.objects
        replaced_asset = await repository.get_asset(actor, attachment.media_asset_id)
        assert replaced_asset["revision"] == 3
        with pytest.raises(StorageError) as stale:
            await upload.create_upload_session(
                actor,
                display_name="Stale.mp4",
                mime_type="video/mp4",
                size_bytes=80,
                idempotency_key="stale-replacement",
                replace_media_asset_id=attachment.media_asset_id,
                expected_revision=2,
            )
        assert stale.value.category == "stale_revision"

        async with DurableDatabase(DATABASE_URL).transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    INSERT INTO clip_projects(
                      id,owner_user_id,source_media_asset_id,schema_version,
                      name,status,revision,project
                    ) VALUES (
                      'active-storage-reference',%s,%s,1,'Active','draft',1,
                      jsonb_build_object(
                        'schemaVersion',1,
                        'clipProjectId','active-storage-reference',
                        'revision',1,
                        'sourceMedia',jsonb_build_object('mediaId',%s::text)
                      )
                    )
                    """,
                    (
                        actor.user_id,
                        attachment.media_asset_id,
                        attachment.media_asset_id,
                    ),
                )
        with pytest.raises(StorageError) as referenced:
            await deletion.delete_media(actor, attachment.media_asset_id)
        assert referenced.value.category == "media_asset_not_ready"
        async with DurableDatabase(DATABASE_URL).transaction() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    UPDATE clip_projects
                    SET status='archived',archived_at=now()
                    WHERE id='active-storage-reference'
                    """
                )

        storage.fail_delete = True
        with pytest.raises(StorageError) as failed_delete:
            await deletion.delete_media(actor, attachment.media_asset_id)
        assert failed_delete.value.category == "storage_delete_failed"
        failed_asset = await repository.get_asset(actor, attachment.media_asset_id)
        assert failed_asset["status"] == "deletion_failed"
        storage.fail_delete = False
        deleted = await deletion.delete_media(actor, attachment.media_asset_id)
        assert deleted["status"] == "deleted"
        assert (await deletion.delete_media(actor, attachment.media_asset_id))[
            "status"
        ] == "deleted"
        with pytest.raises(StorageError) as deleted_url:
            await access.create_media_preview_url(actor, attachment.media_asset_id)
        assert deleted_url.value.category == "media_asset_deleted"

        async with DurableDatabase(DATABASE_URL).connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT input FROM processing_jobs WHERE job_type='media_probe'"
                )
                probe_input = (await cursor.fetchone())["input"]
                assert probe_input == {
                    "schemaVersion": 1,
                    "jobType": "media_probe",
                    "mediaAssetId": str(attachment.media_asset_id),
                    "expectedMediaRevision": 2,
                    "storageObjectRevision": 1,
                    "requestedFields": None,
                    "metadata": {
                        "uploadSessionId": str(instructions.upload_session_id)
                    },
                }
                await cursor.execute(
                    """
                    SELECT count(*) FROM media_assets
                    WHERE storage_path LIKE '%%token=%%'
                       OR metadata::text LIKE '%%token=%%'
                    """
                )
                assert (await cursor.fetchone())["count"] == 0

    _run(scenario())
