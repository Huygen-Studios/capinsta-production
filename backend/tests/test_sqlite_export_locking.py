import asyncio

import aiosqlite

import server.api.export_jobs as export_jobs
import server.database as database


def test_export_status_write_waits_for_transient_sqlite_lock(tmp_path, monkeypatch):
    async def run():
        db_path = tmp_path / "export-lock.sqlite"
        monkeypatch.setattr(database, "DB_PATH", db_path)
        monkeypatch.setattr(export_jobs, "DB_PATH", db_path)

        async def skip_mirror(_export_job_id):
            return None

        monkeypatch.setattr(export_jobs, "mirror_export_job", skip_mirror)
        await database.init_db()

        blocker = await aiosqlite.connect(str(db_path))
        await blocker.execute("BEGIN IMMEDIATE")
        await blocker.execute(
            "INSERT INTO admin_idempotency (idempotency_key, action, target_id) VALUES ('lock', 'test', 'test')"
        )

        async def release_lock():
            await asyncio.sleep(0.1)
            await blocker.commit()
            await blocker.close()

        release_task = asyncio.create_task(release_lock())
        job = export_jobs.ExportJobStatus(
            id="export-lock-test",
            source_job_id="caption-1",
            status="running",
            stage="render_video",
            progress=50,
            user_id="user-1",
        )
        await asyncio.wait_for(export_jobs._persist_job(job), timeout=3)
        await release_task

        async with aiosqlite.connect(str(db_path)) as db:
            row = await (
                await db.execute(
                    "SELECT status, stage, progress FROM export_jobs WHERE id = ?",
                    (job.id,),
                )
            ).fetchone()
        assert row == ("running", "render_video", 50)

    asyncio.run(run())
