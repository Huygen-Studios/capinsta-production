import asyncio
import sqlite3

import server.database as database


def test_export_idempotency_index_prevents_duplicate_user_request(
    tmp_path, monkeypatch
):
    path = tmp_path / "runtime.sqlite"
    monkeypatch.setattr(database, "DB_PATH", path)
    asyncio.run(database.init_db())

    columns = [
        "id",
        "source_job_id",
        "status",
        "stage",
        "created_at",
        "updated_at",
        "user_id",
        "idempotency_key",
    ]
    values = (
        "export-1",
        "job-1",
        "queued",
        "queued",
        "2026-06-22T00:00:00Z",
        "2026-06-22T00:00:00Z",
        "user-1",
        "request-1",
    )
    with sqlite3.connect(path) as db:
        db.execute(
            f"INSERT INTO export_jobs ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
            values,
        )
        try:
            db.execute(
                f"INSERT INTO export_jobs ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
                ("export-2", *values[1:]),
            )
        except sqlite3.IntegrityError:
            pass
        else:
            raise AssertionError("duplicate idempotency key was accepted")
