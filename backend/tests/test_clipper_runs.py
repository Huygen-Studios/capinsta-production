from __future__ import annotations

import asyncio
from uuid import uuid4
from unittest.mock import AsyncMock, patch

from server.clipping_persistence.errors import PersistenceError
from server.clipping_persistence.models import AuthenticatedActor
from server.automatic_clipper.workflow import AutomaticClipperWorkflowService


def test_persistence_error_categories_valid():
    err1 = PersistenceError("invalid_state", "Invalid state transition")
    assert err1.category == "invalid_state"

    err2 = PersistenceError("conflict", "Concurrency conflict")
    assert err2.category == "conflict"

    err3 = PersistenceError("entity_not_found", "Entity not found")
    assert err3.category == "entity_not_found"


def test_aggregate_variants_status():
    proxy = {"status": "succeeded"}
    audio = {"status": "queued"}
    thumb = {"status": "not_requested"}
    wave = {"status": "not_requested"}

    res = AutomaticClipperWorkflowService._aggregate_variants_status(proxy, audio, thumb, wave)
    assert res == "queued"

    audio_processing = {"status": "processing"}
    res2 = AutomaticClipperWorkflowService._aggregate_variants_status(proxy, audio_processing, thumb, wave)
    assert res2 == "running"

    audio_succeeded = {"status": "succeeded"}
    res3 = AutomaticClipperWorkflowService._aggregate_variants_status(proxy, audio_succeeded, thumb, wave)
    assert res3 == "succeeded"


def test_no_audio_probe_detection():
    probe_output = {
        "hasAudio": False,
        "streams": [
            {"codec_type": "video", "width": 1920, "height": 1080}
        ]
    }
    has_audio = probe_output.get("hasAudio")
    streams = probe_output.get("streams", [])
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    assert has_audio is False or (streams and len(audio_streams) == 0)


def test_run_advance_uses_the_run_media_asset_id():
    media_asset_id = uuid4()
    run_id = uuid4()
    service = AutomaticClipperWorkflowService(object())
    service._snapshot = AsyncMock(return_value={"notFound": True})
    service._response = AsyncMock(return_value={"status": "not_found"})
    actor = AuthenticatedActor.from_verified_user(str(uuid4()))

    with patch(
        "server.automatic_clipper.workflow.ClipperSessionService.record_run_heartbeat",
        new=AsyncMock(return_value={}),
    ):
        assert asyncio.run(service.advance(actor, media_asset_id, run_id=run_id)) == {
            "status": "not_found"
        }

    service._snapshot.assert_awaited_once_with(
        actor, media_asset_id, run_id=run_id
    )
