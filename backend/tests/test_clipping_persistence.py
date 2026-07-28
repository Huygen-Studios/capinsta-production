import json
from pathlib import Path
from uuid import uuid4

import pytest

from server.clipping_persistence.database import durable_jobs_enabled
from server.clipping_persistence.errors import PersistenceError
from server.clipping_persistence.models import (
    ALLOWED_JOB_TRANSITIONS,
    TERMINAL_JOB_STATUSES,
    validate_job_input,
)
from server.clipping_persistence.validation import (
    ensure_portable_json,
    validate_clip_project,
    validate_transcript,
)

ROOT = Path(__file__).resolve().parents[2]


def test_durable_jobs_are_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_SUPABASE_DURABLE_JOBS", raising=False)
    assert durable_jobs_enabled() is False
    monkeypatch.setenv("ENABLE_SUPABASE_DURABLE_JOBS", "true")
    assert durable_jobs_enabled() is True


def test_job_transition_matrix_has_explicit_terminal_states():
    assert ALLOWED_JOB_TRANSITIONS["queued"] == {
        "claimed",
        "cancel_requested",
        "cancelled",
    }
    assert ALLOWED_JOB_TRANSITIONS["running"] == {
        "succeeded",
        "failed",
        "retry_wait",
        "cancel_requested",
    }
    for status in TERMINAL_JOB_STATUSES:
        assert ALLOWED_JOB_TRANSITIONS[status] == frozenset()


def test_typed_job_inputs_reject_mismatched_or_unknown_payloads():
    media_id = uuid4()
    valid = validate_job_input(
        {
            "schemaVersion": 1,
            "jobType": "transcription",
            "mediaAssetId": str(media_id),
            "languageMode": "auto",
        }
    )
    assert valid["mediaAssetId"] == str(media_id)
    with pytest.raises(Exception):
        validate_job_input({"schemaVersion": 1, "jobType": "transcription"})
    with pytest.raises(Exception):
        validate_job_input({"schemaVersion": 1, "jobType": "not_real"})


def test_contract_row_identity_and_portable_path_validation():
    media_id = uuid4()
    transcript = json.loads(
        (ROOT / "contracts/fixtures/transcript-document-v2/empty.json").read_text(
            encoding="utf-8"
        )
    )
    transcript["transcriptId"] = "tr_test"
    transcript["mediaId"] = str(media_id)
    assert (
        validate_transcript(
            transcript, transcript_id="tr_test", media_asset_id=media_id
        )["durationMs"]
        == 0
    )
    with pytest.raises(PersistenceError) as error:
        validate_transcript(
            transcript, transcript_id="tr_other", media_asset_id=media_id
        )
    assert error.value.category == "invalid_contract"

    project = json.loads(
        (ROOT / "contracts/fixtures/clip-project-v1/empty.json").read_text(
            encoding="utf-8"
        )
    )
    project["clipProjectId"] = "clip_test"
    project["sourceMedia"]["mediaId"] = str(media_id)
    assert (
        validate_clip_project(
            project,
            project_id="clip_test",
            media_asset_id=media_id,
            revision=1,
            transcript_id=None,
        )["revision"]
        == 1
    )
    with pytest.raises(PersistenceError):
        ensure_portable_json({"localPath": "C:\\private\\source.mp4"})


def test_migration_declares_tables_rls_constraints_and_auth_ownership():
    sql = (
        ROOT / "apps/web/migrations/0014_clipping_persistence.sql"
    ).read_text(encoding="utf-8")
    for table in (
        "media_assets",
        "media_variants",
        "transcripts",
        "clip_projects",
        "clip_project_versions",
        "processing_jobs",
        "idempotency_records",
    ):
        assert f'CREATE TABLE "{table}"' in sql
        assert f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY' in sql
    assert "REFERENCES auth.users(id)" in sql
    assert "auth.uid()" in sql
    assert "storage_bucket" in sql and "storage_path" in sql
    assert "signed_url" not in sql.lower()
    assert "absolute_local_path" not in sql.lower()
