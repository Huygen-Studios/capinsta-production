from __future__ import annotations

import json
from pathlib import Path

import pytest

from server.editor_exports import (
    EDITOR_EXPORT_ENGINE_VERSION,
    EditorExportJobHandler,
    EditorExportJobInputV1,
    _remotion_props,
    configured_export_engine,
)


def snapshot(**updates):
    value = {
        "source_job_id": "source-job",
        "captions_json": "[]",
        "theme": "word_highlight_box",
        "style_config_json": None,
        "resolution": "1080p",
        "export_width": 1080,
        "export_height": 1920,
        "export_fps": 30,
        "include_audio": True,
        "quality": "standard",
        "bitrate": "auto",
        "custom_bitrate_mbps": None,
        "export_mode": "full_video",
        "captions_only": False,
        "background_color": "#101010",
        "duration_override": 4.0,
        "duration_source": "frontend",
        "visible_tracks_count": 1,
        "source_media_count": 1,
        "caption_chunks_count": 0,
        "hardware_acceleration": False,
        "render_mode": "headless",
        "original_video_path": "/storage/source.mp4",
        "composition_json": None,
    }
    value.update(updates)
    return value


def test_production_engine_defaults_to_hybrid_and_rejects_typos(monkeypatch):
    monkeypatch.delenv("CAPINSTA_EXPORT_ENGINE", raising=False)
    assert configured_export_engine() == "remotion_hybrid"
    monkeypatch.setenv("CAPINSTA_EXPORT_ENGINE", "automatic")
    with pytest.raises(RuntimeError):
        configured_export_engine()


def test_immutable_remotion_snapshot_preserves_repeated_retimed_edl():
    props = _remotion_props(snapshot())
    edl = props["timeline"]["edl"]
    repeated = [
        {**edl["entries"][0], "id": "a", "order": 0, "playbackRate": 0.5},
        {**edl["entries"][0], "id": "b", "order": 1, "playbackRate": 2},
    ]
    props["timeline"]["edl"] = {**edl, "entries": repeated}
    restored = _remotion_props(snapshot(composition_json=json.dumps(props)))
    assert restored["timeline"]["edl"]["entries"] == repeated


def test_solid_caption_snapshot_keeps_premium_id():
    captions = json.dumps(
        [
            {
                "id": "caption-1",
                "trackId": "captions",
                "start": 0,
                "end": 2,
                "text": "Premium export",
                "stylePresetId": "skyline_italic",
                "style": {"presetId": "skyline_italic"},
                "words": [
                    {
                        "id": "word-1",
                        "start": 0,
                        "end": 2,
                        "text": "Premium",
                        "displayedText": "Premium",
                    }
                ],
            }
        ]
    )
    props = _remotion_props(
        snapshot(
            export_mode="captions_solid_background",
            captions_json=captions,
            theme="skyline_italic",
        )
    )
    assert props["captions"]["document"]["stylePresetId"] == "skyline_italic"
    assert props["captions"]["document"]["clips"][0]["stylePresetId"] == "skyline_italic"


def test_job_contract_is_versioned_and_api_does_not_spawn_export_coroutine():
    value = EditorExportJobInputV1(
        exportJobId="00000000-0000-0000-0000-000000000001",
        ownerUserId="00000000-0000-0000-0000-000000000002",
        engine="remotion_hybrid",
        buildSha="release-sha",
        snapshot=snapshot(),
    )
    EditorExportJobHandler().validate_input(value.model_dump(mode="json"))
    assert value.schemaVersion == 1
    assert value.engineVersion == EDITOR_EXPORT_ENGINE_VERSION
    route_source = (
        Path(__file__).parents[1] / "server" / "api" / "export_jobs.py"
    ).read_text(encoding="utf-8")
    endpoint_source = route_source[route_source.index("async def start_export_job") :]
    endpoint_source = endpoint_source[: endpoint_source.index("async def cancel_project_exports")]
    assert "asyncio.create_task(_run_export_job" not in endpoint_source
    assert "enqueue_editor_export(" in endpoint_source
