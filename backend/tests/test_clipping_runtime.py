import asyncio
import json
import os
from pathlib import Path

import pytest

from server.clipping_runtime.client import ClippingRuntimeClient
from server.clipping_runtime.config import ClippingRuntimeConfig
from server.clipping_runtime.errors import ClippingRuntimeError

ROOT = Path(__file__).parents[2]
EXE = ".exe" if os.name == "nt" else ""
REAL_BINARY = ROOT / "target" / "debug" / f"capinsta-clipping-runtime{EXE}"
HELPER_BINARY = ROOT / "target" / "debug" / f"runtime-test-helper{EXE}"


def _run(coro):
    return asyncio.run(coro)


def _client(binary=REAL_BINARY, **overrides):
    return ClippingRuntimeClient(
        ClippingRuntimeConfig(
            enabled=True,
            binary=str(binary),
            timeout_seconds=overrides.get("timeout_seconds", 10),
            maximum_stdout_bytes=overrides.get("maximum_stdout_bytes", 8_000_000),
            maximum_stderr_bytes=overrides.get("maximum_stderr_bytes", 65_536),
            terminate_grace_seconds=1,
        )
    )


@pytest.fixture(scope="module", autouse=True)
def built_binaries():
    if not REAL_BINARY.exists() or not HELPER_BINARY.exists():
        pytest.skip("Run cargo build -p clipping-runtime --bins for real runtime tests")


def test_real_health_and_version():
    health = _run(_client().health())
    version = _run(_client().version())
    assert health.status == "healthy"
    assert {"derive_project", "convert_project"} <= set(version.operations)
    assert 1 in version.protocolVersions


def test_real_derivation_and_conversion():
    derive_request = json.loads(
        (
            ROOT
            / "contracts/fixtures/clipping-runtime-v1/requests/derive-one-range.json"
        ).read_text("utf-8")
    )
    derived, _ = _run(
        _client().derive_project(
            payload=derive_request["payload"],
            request_id="python_real_derive",
        )
    )
    assert derived.editDecisionList.outputDurationMs == 2000
    assert len(derived.remappedTranscript.words) == 2

    conversion_request = json.loads(
        (
            ROOT
            / "contracts/fixtures/clipping-runtime-v1/requests/convert-without-captions.json"
        ).read_text("utf-8")
    )
    converted, _ = _run(
        _client().convert_project(
            payload=conversion_request["payload"],
            request_id="python_real_convert",
        )
    )
    assert converted.project["version"] == 35
    assert converted.mediaReference["requiresMediaAttachment"] is True


def test_real_automatic_clipper_operations_cross_python_rust_boundary():
    transcript = json.loads(
        (
            ROOT
            / "contracts/fixtures/transcript-document-v2/english-words.json"
        ).read_text("utf-8")
    )
    candidates, _ = _run(
        _client().invoke(
            operation="analyze_candidates",
            payload={
                "transcript": transcript,
                "proposals": [
                    {
                        "sourceStartMs": 0,
                        "sourceEndMs": 1_200,
                        "title": "Synthetic payoff",
                        "hookText": "Watch what changes",
                        "supportingEmojis": ["👨🏽‍💻"],
                        "scoreBreakdown": {
                            "hookStrength": 18,
                            "clarity": 17,
                            "payoff": 18,
                            "emotion": 14,
                            "novelty": 16,
                        },
                        "reason": "Cross-language fixture",
                    }
                ],
                "silenceBoundariesMs": [],
                "promptVersion": "viral-candidates-v1",
                "providerName": "fixture",
                "providerModel": None,
                "providerRequestId": "request_fixture",
            },
            request_id="python_real_candidates",
        )
    )
    assert len(candidates["candidates"]) == 1
    candidate = candidates["candidates"][0]
    assert candidate["supportingEmojis"] == ["👨🏽‍💻"]
    reframe, _ = _run(
        _client().invoke(
            operation="plan_reframe",
            payload={
                "candidateId": candidate["candidateId"],
                "sourceStartMs": candidate["sourceStartMs"],
                "sourceEndMs": candidate["sourceEndMs"],
                "sourceWidth": 1920,
                "sourceHeight": 1080,
                "sceneBoundariesMs": [],
                "detections": [
                    {
                        "timeMs": candidate["sourceStartMs"],
                        "x": 0.35,
                        "y": 0.2,
                        "width": 0.3,
                        "height": 0.4,
                        "confidence": 0.95,
                        "trackId": 1,
                    }
                ],
                "detectorVersion": "fixture-v1",
            },
            request_id="python_real_reframe",
        )
    )
    fixture = json.loads(
        (
            ROOT
            / "contracts/fixtures/capinsta-project-conversion-v1/valid/one-range-1x.json"
        ).read_text("utf-8")
    )
    base_project = fixture["input"]["clipProject"]
    composed, _ = _run(
        _client().invoke(
            operation="compose_short",
            payload={
                "baseProject": base_project,
                "candidate": candidate,
                "reframePlan": reframe,
                "hookOverlay": {
                    "text": candidate["hookText"],
                    "supportingEmojis": candidate["supportingEmojis"],
                    "startMs": 0,
                    "endMs": candidate["durationMs"],
                    "position": "top",
                    "maximumLines": 2,
                    "stylePreset": "hook-bold-v1",
                    "animationPreset": "pop",
                    "safeZoneProfile": "shorts-generic-v1",
                    "transcriptEvidence": candidate["transcriptEvidence"],
                },
                "captionPreset": "word_highlight_box",
                "wordSpacing": 12,
                "expectedRevision": base_project["revision"],
                "acceptedSilenceIntervals": [
                    {"sourceStartMs": 500, "sourceEndMs": 700}
                ],
            },
            request_id="python_real_compose",
        )
    )
    automatic = composed["project"]["metadata"]["automaticClipper"]
    assert composed["project"]["canvas"]["aspectRatio"] == "9:16"
    assert len(composed["project"]["ranges"]) == 2
    assert composed["compositionReport"]["rangeCount"] == 2
    assert automatic["captionComposition"]["wordSpacing"] == 12
    assert automatic["hookOverlay"]["supportingEmojis"] == ["👨🏽‍💻"]


def test_real_runtime_structured_domain_error():
    request = json.loads(
        (
            ROOT
            / "contracts/fixtures/clipping-runtime-v1/requests/derive-one-range.json"
        ).read_text("utf-8")
    )
    request["payload"]["transcript"]["mediaId"] = "wrong_media"
    with pytest.raises(ClippingRuntimeError) as error:
        _run(
            _client().derive_project(
                payload=request["payload"],
                request_id="python_real_invalid",
            )
        )
    assert error.value.code == "clip_project_transcript_mismatch"


def test_missing_executable():
    with pytest.raises(ClippingRuntimeError, match="unavailable") as error:
        _run(_client(ROOT / "missing-runtime").health())
    assert error.value.code == "clipping_runtime_missing"


@pytest.mark.parametrize(
    ("mode", "expected"),
    [
        ("invalid", "clipping_runtime_invalid_response"),
        ("multiple", "clipping_runtime_invalid_response"),
        ("mismatch", "clipping_runtime_request_mismatch"),
        ("oversized", "clipping_runtime_output_too_large"),
        ("stderr", "clipping_runtime_stderr_too_large"),
    ],
)
def test_bounded_invalid_helper_responses(monkeypatch, mode, expected):
    monkeypatch.setenv("CLIPPING_RUNTIME_FAKE_MODE", mode)
    client = _client(
        HELPER_BINARY,
        maximum_stdout_bytes=1024,
        maximum_stderr_bytes=1024,
    )
    with pytest.raises(ClippingRuntimeError) as error:
        _run(client.health())
    assert error.value.code == expected


def test_timeout_terminates_helper(monkeypatch):
    monkeypatch.setenv("CLIPPING_RUNTIME_FAKE_MODE", "sleep")
    with pytest.raises(ClippingRuntimeError) as error:
        _run(_client(HELPER_BINARY, timeout_seconds=1).health())
    assert error.value.code == "clipping_runtime_timeout"


def test_cancellation_and_lease_loss_terminate_helper(monkeypatch):
    monkeypatch.setenv("CLIPPING_RUNTIME_FAKE_MODE", "sleep")

    async def cancelled():
        event = asyncio.Event()
        event.set()
        await _client(HELPER_BINARY).invoke(
            operation="health",
            payload={},
            request_id="cancelled",
            cancellation_event=event,
        )

    async def lease_lost():
        event = asyncio.Event()
        event.set()
        await _client(HELPER_BINARY).invoke(
            operation="health",
            payload={},
            request_id="lease",
            lease_lost_event=event,
        )

    with pytest.raises(ClippingRuntimeError) as cancelled_error:
        _run(cancelled())
    assert cancelled_error.value.code == "clipping_runtime_cancelled"
    with pytest.raises(ClippingRuntimeError) as lease_error:
        _run(lease_lost())
    assert lease_error.value.code == "clipping_runtime_lease_lost"


def test_shutdown_and_task_cancellation_terminate_helper(monkeypatch):
    monkeypatch.setenv("CLIPPING_RUNTIME_FAKE_MODE", "sleep")

    async def shutdown():
        event = asyncio.Event()
        event.set()
        await _client(HELPER_BINARY).invoke(
            operation="health",
            payload={},
            request_id="shutdown",
            shutdown_event=event,
        )

    with pytest.raises(ClippingRuntimeError) as shutdown_error:
        _run(shutdown())
    assert shutdown_error.value.code == "clipping_runtime_cancelled"

    async def cancel_task():
        task = asyncio.create_task(
            _client(HELPER_BINARY).invoke(
                operation="health",
                payload={},
                request_id="task_cancel",
            )
        )
        await asyncio.sleep(0.15)
        task.cancel()
        await task

    with pytest.raises(asyncio.CancelledError):
        _run(cancel_task())


def test_successful_runtime_fixtures_validate_in_python():
    from server.clipping_runtime.contracts import RuntimeResponseV1

    for path in (
        ROOT / "contracts/fixtures/clipping-runtime-v1/responses"
    ).glob("*.json"):
        response = RuntimeResponseV1.model_validate_json(path.read_text("utf-8"))
        assert response.ok
