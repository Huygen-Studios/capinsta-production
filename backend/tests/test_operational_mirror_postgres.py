import asyncio
import os
import selectors
import uuid

import pytest

import server.operational_mirror as mirror

psycopg = pytest.importorskip("psycopg")


@pytest.mark.skipif(
    not os.getenv("ADMIN_MIGRATION_TEST_DATABASE_URL"),
    reason="Disposable PostgreSQL URL is required",
)
def test_caption_and_export_events_are_idempotent(monkeypatch):
    database_url = os.environ["ADMIN_MIGRATION_TEST_DATABASE_URL"]
    monkeypatch.setenv("ADMIN_DATABASE_URL", database_url)
    user_id = str(uuid.uuid4())
    caption_id = f"caption-{uuid.uuid4()}"
    export_id = f"export-{uuid.uuid4()}"
    correlation_id = str(uuid.uuid4())

    async def run():
        async with await psycopg.AsyncConnection.connect(database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "INSERT INTO profiles (user_id, email_snapshot) VALUES (%s::uuid, %s)",
                    (user_id, "mirror@example.invalid"),
                )
            await connection.commit()
        caption = {
            "id": caption_id,
            "user_id": user_id,
            "project_id": caption_id,
            "source_filename": "source.mp4",
            "language": "auto",
            "provider": "test",
            "media_duration_seconds": 120,
            "status": "completed",
            "progress": 100,
            "word_count": 10,
            "caption_count": 3,
            "queued_at": "2026-01-01T00:00:00+00:00",
            "started_at": "2026-01-01T00:00:01+00:00",
            "completed_at": "2026-01-01T00:00:10+00:00",
            "cancelled_at": None,
            "retry_count": 0,
            "sanitized_error_code": None,
            "sanitized_error_message": None,
            "correlation_id": correlation_id,
            "retry_of_job_id": None,
            "admin_retry_by": None,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:10+00:00",
        }
        await mirror.deliver_event("caption_job", caption)
        await mirror.deliver_event("caption_job", {**caption, "word_count": 12})
        export = {
            "id": export_id,
            "user_id": user_id,
            "project_id": caption_id,
            "source_caption_job_id": caption_id,
            "mode": "full_video",
            "status": "completed",
            "stage": "completed",
            "progress": 100,
            "width": 1080,
            "height": 1920,
            "fps": 30,
            "duration_seconds": 120,
            "output_size_bytes": 1000,
            "render_time_seconds": 15,
            "queued_at": "2026-01-01T00:00:00+00:00",
            "started_at": "2026-01-01T00:00:01+00:00",
            "completed_at": "2026-01-01T00:00:20+00:00",
            "cancelled_at": None,
            "retry_count": 0,
            "error_class": None,
            "sanitized_error_message": None,
            "output_expiry": "2026-01-02T00:00:00+00:00",
            "correlation_id": correlation_id,
            "retry_of_export_id": None,
            "admin_retry_by": None,
            "immutable_input": "{}",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:20+00:00",
        }
        await mirror.deliver_event("export_job", export)
        await mirror.deliver_event("export_job", export)
        async with await psycopg.AsyncConnection.connect(database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT word_count FROM caption_jobs WHERE id = %s", (caption_id,))
                assert (await cursor.fetchone())[0] == 12
                await cursor.execute("SELECT count(*) FROM export_jobs WHERE id = %s", (export_id,))
                assert (await cursor.fetchone())[0] == 1
                await cursor.execute(
                    "SELECT count(*) FROM usage_events WHERE event_key IN (%s, %s)",
                    (f"caption-completed:{caption_id}", f"export-completed:{export_id}"),
                )
                assert (await cursor.fetchone())[0] == 2

    if os.name == "nt":
        with asyncio.Runner(
            loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector())
        ) as runner:
            runner.run(run())
    else:
        asyncio.run(run())
