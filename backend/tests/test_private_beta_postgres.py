from uuid import uuid4

import asyncio

import pytest

psycopg = pytest.importorskip("psycopg")

from server.production.quotas import QuotaExceededError, reserve_project_admission
from test_clipping_orchestration_postgres import DATABASE_URL, ROOT, _prepare_database, _run


pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="Disposable PostgreSQL 17 test URL required"
)


def _migrate():
    _prepare_database()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute(
            """CREATE TABLE profiles(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
            CREATE TABLE app_permissions(key text PRIMARY KEY, description text NOT NULL);
            CREATE TABLE system_settings(key text PRIMARY KEY, value jsonb NOT NULL, description text NOT NULL);"""
        )
        connection.execute(
            (ROOT / "apps/web/migrations/0026_private_beta_launch.sql").read_text("utf-8")
        )


def test_private_beta_migration_rls_and_source_admission(monkeypatch):
    _migrate()
    owner, other, asset = uuid4(), uuid4(), uuid4()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("INSERT INTO auth.users VALUES (%s,%s),(%s,%s)", (owner, "a@example.invalid", other, "b@example.invalid"))
        connection.execute("INSERT INTO profiles VALUES (%s),(%s)", (owner, other))
        connection.execute(
            """INSERT INTO media_assets(id,owner_user_id,display_name,mime_type,media_kind,source_type,
            duration_ms,size_bytes,storage_bucket,storage_path,storage_object_revision,status,metadata,revision)
            VALUES(%s,%s,'source.mp4','video/mp4','video','uploaded',60000,100,
            'source-media','owner/source.mp4',1,'ready','{}',1)""",
            (asset, owner),
        )
    monkeypatch.setenv("ENABLE_USAGE_QUOTAS", "true")
    monkeypatch.setenv("DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("PRIVATE_BETA_MAX_SOURCE_DURATION_SECONDS", "60")
    key = _run(reserve_project_admission(user_id=str(owner), media_asset_id=str(asset), idempotency_key="source-admission-1"))
    assert key == "clip-project:source-admission-1"
    assert _run(reserve_project_admission(user_id=str(owner), media_asset_id=str(asset), idempotency_key="source-admission-1")) == key
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute("SELECT status FROM usage_reservations").fetchone()[0] == "reserved"
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE authenticated")
        connection.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(owner),))
        assert connection.execute("SELECT count(*) FROM usage_reservations").fetchone()[0] == 1
        connection.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(other),))
        assert connection.execute("SELECT count(*) FROM usage_reservations").fetchone()[0] == 0
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("SET ROLE authenticated")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("INSERT INTO usage_reservations(idempotency_key,user_id,resource_type,resource_id,metric,quantity,unit,expires_at) VALUES ('browser-write-denied',%s,'x','x','x',1,'count',now())", (owner,))
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute("DELETE FROM usage_reservations")
    monkeypatch.setenv("PRIVATE_BETA_PROCESSING_MINUTES", "1")

    async def concurrent_admission():
        return await asyncio.gather(
            reserve_project_admission(user_id=str(owner), media_asset_id=str(asset), idempotency_key="source-admission-2"),
            reserve_project_admission(user_id=str(owner), media_asset_id=str(asset), idempotency_key="source-admission-3"),
            return_exceptions=True,
        )

    results = _run(concurrent_admission())
    assert sum(isinstance(result, QuotaExceededError) for result in results) == 1
    monkeypatch.setenv("PRIVATE_BETA_MAX_SOURCE_DURATION_SECONDS", "59")
    with pytest.raises(QuotaExceededError, match="source_duration_limit_exceeded"):
        _run(reserve_project_admission(user_id=str(owner), media_asset_id=str(asset), idempotency_key="source-admission-4"))
