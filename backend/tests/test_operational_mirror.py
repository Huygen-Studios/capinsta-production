import asyncio
import json

import aiosqlite

import server.operational_mirror as mirror


def test_sanitize_error_redacts_secrets():
    sanitized = mirror.sanitize_error("api_key=secret-value bearer abc.def password=hunter2")
    assert "secret-value" not in sanitized
    assert "abc.def" not in sanitized
    assert "hunter2" not in sanitized


def test_mirror_event_is_idempotently_queued(tmp_path, monkeypatch):
    async def run():
        db_path = tmp_path / "mirror.sqlite"
        monkeypatch.setattr(mirror, "DB_PATH", db_path)
        async with aiosqlite.connect(str(db_path)) as db:
            await db.execute(
                """
                CREATE TABLE operational_outbox (
                  event_id TEXT PRIMARY KEY, event_type TEXT, record_id TEXT,
                  payload_json TEXT, attempts INTEGER, last_error TEXT,
                  created_at TEXT, next_attempt_at TEXT
                )
                """
            )
            await db.commit()
        payload = {"id": "job-1", "updated_at": "2026-01-01T00:00:00Z", "status": "queued"}
        await mirror.mirror_event("caption_job", "job-1", payload)
        await mirror.mirror_event("caption_job", "job-1", {**payload, "status": "running"})
        async with aiosqlite.connect(str(db_path)) as db:
            rows = await (await db.execute("SELECT payload_json FROM operational_outbox")).fetchall()
        assert len(rows) == 1
        assert json.loads(rows[0][0])["status"] == "running"

    asyncio.run(run())


def test_outbox_retries_and_then_deletes(tmp_path, monkeypatch):
    async def run():
        db_path = tmp_path / "flush.sqlite"
        monkeypatch.setattr(mirror, "DB_PATH", db_path)
        async with aiosqlite.connect(str(db_path)) as db:
            await db.execute(
                """
                CREATE TABLE operational_outbox (
                  event_id TEXT PRIMARY KEY, event_type TEXT, record_id TEXT,
                  payload_json TEXT, attempts INTEGER, last_error TEXT,
                  created_at TEXT, next_attempt_at TEXT
                )
                """
            )
            await db.execute(
                "INSERT INTO operational_outbox VALUES ('e1','caption_job','job-1','{}',0,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
            )
            await db.commit()
        calls = 0

        async def deliver(*_):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("temporary")

        monkeypatch.setattr(mirror, "deliver_event", deliver)
        first = await mirror.flush_operational_outbox()
        assert first["failed"] == 1
        async with aiosqlite.connect(str(db_path)) as db:
            await db.execute("UPDATE operational_outbox SET next_attempt_at = CURRENT_TIMESTAMP")
            await db.commit()
        second = await mirror.flush_operational_outbox()
        assert second["delivered"] == 1

    asyncio.run(run())


def test_outbox_delivery_does_not_hold_sqlite_write_lock(tmp_path, monkeypatch):
    async def run():
        db_path = tmp_path / "nonblocking-flush.sqlite"
        monkeypatch.setattr(mirror, "DB_PATH", db_path)
        async with aiosqlite.connect(str(db_path)) as db:
            await db.execute(
                """
                CREATE TABLE operational_outbox (
                  event_id TEXT PRIMARY KEY, event_type TEXT, record_id TEXT,
                  payload_json TEXT, attempts INTEGER, last_error TEXT,
                  created_at TEXT, next_attempt_at TEXT
                )
                """
            )
            await db.executemany(
                "INSERT INTO operational_outbox VALUES (?,?,?,?,0,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                [
                    ("e1", "caption_job", "job-1", "{}"),
                    ("e2", "caption_job", "job-2", "{}"),
                ],
            )
            await db.commit()

        second_delivery_started = asyncio.Event()
        release_second_delivery = asyncio.Event()
        deliveries = 0

        async def deliver(*_):
            nonlocal deliveries
            deliveries += 1
            if deliveries == 2:
                second_delivery_started.set()
                await release_second_delivery.wait()

        monkeypatch.setattr(mirror, "deliver_event", deliver)
        flush_task = asyncio.create_task(mirror.flush_operational_outbox())
        await asyncio.wait_for(second_delivery_started.wait(), timeout=2)

        async with aiosqlite.connect(str(db_path), timeout=0.1) as db:
            await db.execute(
                "INSERT INTO operational_outbox VALUES ('concurrent','caption_job','job-3','{}',0,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
            )
            await db.commit()

        release_second_delivery.set()
        result = await asyncio.wait_for(flush_task, timeout=2)
        assert result["delivered"] == 2

    asyncio.run(run())


def test_mirror_enqueue_failure_does_not_fail_runtime_job(monkeypatch):
    async def run():
        async def payload(_job_id):
            return {"id": "export-1", "updated_at": "2026-01-01T00:00:00Z"}

        async def enqueue(*_):
            raise aiosqlite.OperationalError("database is locked")

        monkeypatch.setattr(mirror, "export_payload", payload)
        monkeypatch.setattr(mirror, "mirror_event", enqueue)
        await mirror.mirror_export_job("export-1")

    asyncio.run(run())
