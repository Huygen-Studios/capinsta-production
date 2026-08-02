import asyncio
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from server.clip_batches.contracts import CreateItemRequest, MAX_CLIP_DURATION_MS, SyncEditorProjectRequest
from server.clip_batches.repository import ClipBatchRepository
from server.api.clipping_batches import _advance_completed_caption, _create_project
from server.main import app

ROOT = Path(__file__).parents[2]


def test_manual_clip_range_accepts_three_minutes_and_rejects_invalid_duration():
    CreateItemRequest(title="Clip 1", sourceStartMs=1_000, sourceEndMs=1_000 + MAX_CLIP_DURATION_MS)
    for start, end in [(0, 0), (10, 9), (0, MAX_CLIP_DURATION_MS + 1)]:
        with pytest.raises(ValidationError):
            CreateItemRequest(title="Invalid", sourceStartMs=start, sourceEndMs=end)


def test_batch_item_contract_derives_duration_without_mutating_timing():
    batch_id = uuid4()
    item_id = uuid4()
    item = ClipBatchRepository._item(
        {
            "id": item_id,
            "batch_id": batch_id,
            "ordinal": 2,
            "title": "Clip 2",
            "source_start_ms": 12_345,
            "source_end_ms": 22_345,
            "status": "draft",
            "selected_for_export": True,
            "child_project_id": None,
            "child_project_revision": None,
            "caption_status": "not_requested",
            "caption_job_id": None,
            "heading_status": "not_requested",
            "export_status": "not_requested",
            "created_at": "2026-08-02T00:00:00Z",
            "updated_at": "2026-08-02T00:00:00Z",
            "revision": 1,
        }
    )
    assert item["sourceStartMs"] == 12_345
    assert item["sourceEndMs"] == 22_345
    assert item["durationMs"] == 10_000


def test_editor_project_sync_requires_the_existing_v35_contract():
    SyncEditorProjectRequest(
        expectedItemRevision=1,
        project={"version": 35, "metadata": {"id": "project_1"}},
    )
    with pytest.raises(ValidationError):
        SyncEditorProjectRequest(
            expectedItemRevision=1,
            project={"version": 34, "metadata": {"id": "project_1"}},
        )


def test_batch_routes_are_registered_for_both_api_versions():
    paths = app.openapi()["paths"]
    for prefix in ("/api", "/api/v1"):
        assert "post" in paths[f"{prefix}/clipping/batches"]
        assert "get" in paths[f"{prefix}/clipping/batches/{{batch_id}}"]
        assert "post" in paths[f"{prefix}/clipping/batches/{{batch_id}}/materialize"]
        assert "post" in paths[f"{prefix}/clipping/batches/{{batch_id}}/captions"]
        assert "post" in paths[f"{prefix}/clipping/batches/{{batch_id}}/exports"]
        assert "put" in paths[f"{prefix}/clipping/batches/{{batch_id}}/items/{{item_id}}/editor-project"]
        assert "post" in paths[f"{prefix}/clipping/batches/{{batch_id}}/items/{{item_id}}/reset-materialization"]
        assert "delete" in paths[f"{prefix}/clipping/batches/{{batch_id}}"]


def test_migration_enforces_owner_rls_and_three_minute_limit():
    sql = (ROOT / "apps/web/migrations/0032_manual_clip_batches.sql").read_text("utf-8")
    assert "source_end_ms - source_start_ms <= 180000" in sql
    assert 'ALTER TABLE "clip_batches" ENABLE ROW LEVEL SECURITY' in sql
    assert 'ALTER TABLE "clip_batch_items" ENABLE ROW LEVEL SECURITY' in sql
    assert "auth.uid() = owner_user_id" in sql
    assert '"caption_job_id" text' in sql
    assert '"clip_batch_exports"' in sql


def test_materialized_heading_reuses_the_normal_editable_text_conversion():
    batch_id = uuid4()
    item_id = uuid4()
    media_id = uuid4()

    class Batches:
        async def context(self, *_args):
            return {
                "batch": {
                    "source_media_asset_id": media_id,
                    "title": "Batch",
                    "platform_preset": "instagram_reels",
                    "headings_enabled": True,
                },
                "media": {"duration_ms": 60_000},
                "transcriptId": "tr_manual",
            }

        async def ensure_item_transcript(self, *_args):
            return "tr_clip_item"

    class Projects:
        request = None

        async def create_project(self, _actor, request, **_kwargs):
            self.request = request
            return {"project": {"clipProjectId": "clip_project"}, "revision": 1}

        async def request_derivation(self, *_args, **_kwargs):
            return None

    projects = Projects()
    asyncio.run(
        _create_project(
            Batches(),
            projects,
            SimpleNamespace(),
            batch_id,
            item={"id": item_id, "title": "Clip 1", "source_start_ms": 10_000, "source_end_ms": 25_000},
        )
    )
    heading = projects.request.metadata["automaticClipper"]["hookOverlay"]
    assert heading == {
        "text": "Add a heading",
        "supportingEmojis": [],
        "startMs": 0,
        "endMs": 15_000,
        "position": "top",
    }


def test_caption_completion_waits_for_durable_derivation_and_conversion():
    class Batches:
        calls = 0

        async def persist_caption_transcript(self, *_args, **_kwargs):
            self.calls += 1
            return {"childProjectId": "clip_project", "childProjectRevision": 2}

    class Projects:
        phase = "derive"
        derive_calls = 0
        conversion_calls = 0

        async def get_detail(self, *_args):
            return {"derived": {
                "remappedTranscriptStatus": "current" if self.phase != "derive" else "missing",
                "conversionStatus": "current" if self.phase == "done" else "missing",
            }}

        async def request_derivation(self, *_args, **_kwargs):
            self.derive_calls += 1
            return {"status": "queued"}

        async def request_conversion(self, *_args, **_kwargs):
            self.conversion_calls += 1
            return {"status": "queued"}

    batches, projects = Batches(), Projects()
    args = (batches, projects, SimpleNamespace(), uuid4(), uuid4(), "job-1", {"segments": []})
    assert asyncio.run(_advance_completed_caption(*args)) == "processing"
    assert (projects.derive_calls, projects.conversion_calls) == (1, 0)
    projects.phase = "convert"
    assert asyncio.run(_advance_completed_caption(*args)) == "processing"
    assert (projects.derive_calls, projects.conversion_calls) == (1, 1)
    projects.phase = "done"
    assert asyncio.run(_advance_completed_caption(*args)) == "completed"
    assert batches.calls == 3
