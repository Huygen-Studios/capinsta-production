from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import UUID

import pytest

psycopg = pytest.importorskip("psycopg")

from server.clip_batches.contracts import CreateBatchRequest, CreateItemRequest
from server.api.clipping_batches import _create_project
from server.clipping_orchestration.repository import ClippingOrchestrationRepository
from server.clip_batches.repository import ClipBatchRepository
from server.clip_batches.errors import ClipBatchError
from server.clipping_persistence.database import DurableDatabase
from test_clipping_orchestration_postgres import _prepare_database, _run, _seed

ROOT = Path(__file__).parents[2]
DATABASE_URL = os.getenv("CLIPPING_PERSISTENCE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable PostgreSQL 17 test URL required")


def _prepare() -> None:
    _prepare_database()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        connection.execute((ROOT / "apps/web/migrations/0032_manual_clip_batches.sql").read_text("utf-8"))


def test_clip_batch_migration_has_rls_constraints_and_browser_write_denial():
    _prepare()
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        assert connection.execute(
            "SELECT relrowsecurity FROM pg_class WHERE oid='clip_batches'::regclass"
        ).fetchone() == (True,)
        constraints = {
            row[0]
            for row in connection.execute(
                "SELECT conname FROM pg_constraint WHERE conrelid='clip_batch_items'::regclass"
            )
        }
        assert {"clip_batch_items_range_check", "clip_batch_items_ordinal_unique"} <= constraints
        assert connection.execute(
            "SELECT has_table_privilege('authenticated','clip_batches','INSERT')"
        ).fetchone() == (False,)


def test_overlapping_items_are_independent_and_batch_creation_is_idempotent():
    _prepare()
    actor, asset, _ = _seed()
    repository = ClipBatchRepository(DurableDatabase(DATABASE_URL))
    request = CreateBatchRequest(sourceMediaAssetId=asset, title="Manual clips")
    first = _run(repository.create(actor, request, idempotency_key="same-upload"))
    replay = _run(repository.create(actor, request, idempotency_key="same-upload"))
    assert replay["id"] == first["id"]
    batch_id = UUID(first["id"])
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute(
            "SELECT count(*) FROM processing_jobs WHERE job_type IN ('transcription','viral_candidate_analysis')"
        ).fetchone() == (0,)

    async def add_overlapping():
        return await asyncio.gather(
            repository.add_item(
                actor,
                batch_id,
                CreateItemRequest(title="Clip 1", sourceStartMs=1_000, sourceEndMs=11_000),
            ),
            repository.add_item(
                actor,
                batch_id,
                CreateItemRequest(title="Clip 2", sourceStartMs=5_000, sourceEndMs=15_000),
            ),
        )

    items = _run(add_overlapping())
    assert {item["sourceStartMs"] for item in items} == {1_000, 5_000}
    assert len({item["id"] for item in items}) == 2
    with pytest.raises(ClipBatchError, match="Captions are disabled"):
        _run(repository.begin_caption(actor, batch_id, UUID(items[0]["id"])))
    with psycopg.connect(DATABASE_URL) as connection:
        assert connection.execute(
            "SELECT count(*) FROM processing_jobs WHERE job_type IN ('transcription','transcript_analysis')"
        ).fetchone() == (0,)


def test_completed_range_caption_is_durable_idempotent_and_project_bound():
    _prepare()
    actor, asset, _ = _seed()
    database = DurableDatabase(DATABASE_URL)
    batches = ClipBatchRepository(database)
    projects = ClippingOrchestrationRepository(database)
    batch = _run(batches.create(
        actor,
        CreateBatchRequest(sourceMediaAssetId=asset, title="Captioned clips", captionsEnabled=True),
        idempotency_key="caption-batch",
    ))
    batch_id = UUID(batch["id"])
    first = _run(batches.add_item(actor, batch_id, CreateItemRequest(title="Clip 1", sourceStartMs=10_000, sourceEndMs=20_000)))
    second = _run(batches.add_item(actor, batch_id, CreateItemRequest(title="Clip 2", sourceStartMs=15_000, sourceEndMs=25_000)))

    async def materialize(item):
        raw = {"id": UUID(item["id"]), "title": item["title"], "source_start_ms": item["sourceStartMs"], "source_end_ms": item["sourceEndMs"]}
        project_id, revision = await _create_project(batches, projects, actor, batch_id, item=raw)
        return await batches.set_child_project(actor, batch_id, UUID(item["id"]), project_id, revision)

    first = _run(materialize(first))
    second = _run(materialize(second))
    assert first["childProjectId"] != second["childProjectId"]
    _run(batches.set_caption_job(actor, batch_id, UUID(first["id"]), job_id="caption-job-1", status="processing"))
    with pytest.raises(ClipBatchError, match="Another clip"):
        _run(batches.begin_caption(actor, batch_id, UUID(second["id"])))
    transcript = {"languageMode": "en", "provider": "test", "segments": [{"start": 0.25, "end": 1.5, "text": "Durable words", "words": [{"word": "Durable", "start": 0.25, "end": 0.8}]}]}
    persisted = _run(batches.persist_caption_transcript(
        actor, batch_id, UUID(first["id"]), job_id="caption-job-1", transcript=transcript
    ))
    replay = _run(batches.persist_caption_transcript(
        actor, batch_id, UUID(first["id"]), job_id="caption-job-1", transcript=transcript
    ))
    assert replay["childProjectRevision"] == persisted["childProjectRevision"]
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            "SELECT id,document,revision FROM transcripts WHERE id IN (SELECT transcript_id FROM clip_projects WHERE id IN (%s,%s)) ORDER BY id",
            (first["childProjectId"], second["childProjectId"]),
        ).fetchall()
        assert len(rows) == 2 and rows[0][0] != rows[1][0]
        generated = next(row for row in rows if row[1]["segments"])
        assert generated[1]["segments"][0]["startMs"] == 10_250
        assert generated[1]["segments"][0]["text"] == "Durable words"
        assert connection.execute(
            "SELECT count(*) FROM clip_project_versions WHERE clip_project_id=%s AND change_summary='Persist generated clip captions'",
            (first["childProjectId"],),
        ).fetchone() == (1,)

    reset = _run(batches.reset_item_materialization(actor, batch_id, UUID(first["id"])))
    assert reset["childProjectId"] is None
    assert reset["childProjectRevision"] is None
    assert reset["captionStatus"] == "not_requested"
