import asyncio
import sqlite3

import server.database as database
from server.api.export_jobs import _normalized_export_idempotency_input


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


def test_export_idempotency_input_changes_when_material_payload_changes():
    base = _normalized_export_idempotency_input(
        source_job_id="job-1",
        captions_json="[]",
        theme="word_highlight_box",
        style_config_json=None,
        resolution="1080p",
        export_width=None,
        export_height=None,
        export_fps=30,
        include_audio=True,
        quality="standard",
        bitrate="auto",
        custom_bitrate_mbps=None,
        export_mode="full_video",
        background_color="#101010",
        duration_override=10.0,
        duration_source="frontend",
        hardware_acceleration=False,
        render_mode="headless",
        composition_json=None,
    )
    changed = _normalized_export_idempotency_input(
        **{**base, "resolution": "720p"},
    )

    assert base == dict(base)
    assert changed != base
