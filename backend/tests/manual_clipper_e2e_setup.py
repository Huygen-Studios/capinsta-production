"""Prepare the disposable PostgreSQL database used by the browser E2E."""

import os
from pathlib import Path

import psycopg

from server.auth import LOCAL_DEVELOPMENT_USER_ID
from test_clipping_orchestration_postgres import _prepare_database


ROOT = Path(__file__).parents[2]
DATABASE_URL = os.environ["CLIPPING_PERSISTENCE_TEST_DATABASE_URL"]


def main() -> None:
    _prepare_database()
    migrations = (
        "0025_automatic_clipper.sql",
        "0027_source_media_bucket_limit.sql",
        "0028_r2_media_storage.sql",
        "0029_worker_heartbeat_and_ephemeral_sessions.sql",
        "0030_automatic_clipper_runs.sql",
        "0031_provider_neutral_upload_bucket_constraint.sql",
        "0032_manual_clip_batches.sql",
    )
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        for name in migrations:
            connection.execute((ROOT / "apps/web/migrations" / name).read_text("utf-8"))
        connection.execute(
            "INSERT INTO auth.users(id,email) VALUES (%s,%s) ON CONFLICT (id) DO NOTHING",
            (LOCAL_DEVELOPMENT_USER_ID, "local-clipper@capinsta.invalid"),
        )


if __name__ == "__main__":
    main()
