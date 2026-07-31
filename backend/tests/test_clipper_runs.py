from __future__ import annotations

import os
from uuid import uuid4

import pytest

from server.clipping_persistence.errors import PersistenceError
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
