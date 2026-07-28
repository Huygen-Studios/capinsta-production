import asyncio
import json
import sys
import types
from pathlib import Path

import pytest
from pydantic import ValidationError

from server.automatic_clipper.config import AutomaticClipperConfig
from server.automatic_clipper.contracts import (
    CandidateSelectionRequestV1,
    ReframePlanV1,
    ViralCandidateAnalysisDocumentV1,
)
from server.automatic_clipper.provider import (
    ExistingLlmCandidateProvider,
    bounded_transcript_payload,
)
from server.automatic_clipper.vision import _detector
from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure


def _run(coro):
    return asyncio.run(coro)


def test_bounded_transcript_input_does_not_duplicate_a_long_document():
    document = {
        "durationMs": 1_800_000,
        "detectedLanguages": ["en", "hi"],
        "segments": [
            {
                "id": f"seg_{index:06}",
                "startMs": index * 1_000,
                "endMs": (index + 1) * 1_000,
                "text": "synthetic " * 100,
                "confidence": 0.9,
            }
            for index in range(1_800)
        ],
        "words": [{"text": "must never be copied"}] * 100_000,
    }
    encoded = bounded_transcript_payload(document, 28_000)
    parsed = json.loads(encoded)
    assert len(encoded) <= 29_000
    assert len(parsed["segments"]) < 1_800
    assert "words" not in parsed
    assert "must never be copied" not in encoded


def test_contracts_reject_invalid_emoji_count_layout_and_reframe_regions():
    with pytest.raises(ValidationError):
        CandidateSelectionRequestV1(
            expectedRevision=1,
            supportingEmojis=["1", "2", "3"],
            framingStrategy="arbitrary",
        )
    with pytest.raises(ValidationError):
        ReframePlanV1.model_validate(
            {
                "schemaVersion": 1,
                "candidateId": "candidate_001",
                "sourceWidth": 1920,
                "sourceHeight": 1080,
                "targetWidth": 1080,
                "targetHeight": 1920,
                "shots": [
                    {
                        "sourceStartMs": 0,
                        "sourceEndMs": 5_000,
                        "strategy": "dual_subject_split",
                        "cropKeyframes": [],
                        "layoutRegions": [
                            {
                                "id": "bad",
                                "role": "identity",
                                "sourceCenterX": 0.5,
                                "sourceCenterY": 0.5,
                                "outputCenterX": 0.5,
                                "outputCenterY": 0.5,
                                "outputWidth": 1,
                                "outputHeight": 1,
                            }
                        ],
                        "confidence": 0.8,
                        "reasonCode": "fixture",
                    }
                ],
                "warnings": [],
            }
        )


def test_candidate_document_rejects_nondeterministic_order():
    base = {
        "sourceStartMs": 0,
        "sourceEndMs": 20_000,
        "durationMs": 20_000,
        "title": "Synthetic",
        "hookText": "Synthetic",
        "supportingEmojis": [],
        "scoreBreakdown": {
            "hookStrength": 10,
            "clarity": 10,
            "payoff": 10,
            "emotion": 10,
            "novelty": 10,
        },
        "reason": "fixture",
        "transcriptEvidence": {"wordIds": [], "segmentIds": [], "excerpt": ""},
        "recommendedFramingStrategy": "automatic",
        "recommendedCaptionPreset": "word_highlight_box",
        "warnings": [],
    }
    with pytest.raises(ValidationError):
        ViralCandidateAnalysisDocumentV1.model_validate(
            {
                "schemaVersion": 1,
                "transcriptId": "tr_fixture",
                "mediaId": "media_fixture",
                "durationMs": 60_000,
                "promptVersion": "viral-candidates-v1",
                "provider": {"name": "fixture"},
                "candidates": [
                    {**base, "candidateId": "candidate_low", "viralScore": 40},
                    {
                        **base,
                        "candidateId": "candidate_high",
                        "sourceStartMs": 20_000,
                        "sourceEndMs": 40_000,
                        "viralScore": 90,
                    },
                ],
                "warnings": [],
            }
        )


def test_provider_malformed_output_is_safe_and_retry_category_is_controlled(monkeypatch):
    class Response:
        id = "request_fixture"
        choices = [
            types.SimpleNamespace(
                message=types.SimpleNamespace(content='{"candidates":"not-an-array"}')
            )
        ]

    class Completions:
        def create(self, **_kwargs):
            return Response()

    class Groq:
        def __init__(self, **_kwargs):
            self.chat = types.SimpleNamespace(
                completions=Completions()
            )

    monkeypatch.setenv("GROQ_API_KEY", "fixture")
    monkeypatch.setitem(sys.modules, "groq", types.SimpleNamespace(Groq=Groq))
    provider = ExistingLlmCandidateProvider(
        timeout_seconds=5, maximum_output_bytes=10_000
    )
    with pytest.raises(ProcessingJobFailure) as error:
        _run(provider.propose('{"segments":[]}'))
    assert error.value.code == "candidate_provider_output_invalid"
    assert error.value.retryable is False


def test_provider_timeout_remains_retryable(monkeypatch):
    async def timeout(awaitable, *_args, **_kwargs):
        awaitable.close()
        raise asyncio.TimeoutError

    monkeypatch.setenv("GROQ_API_KEY", "fixture")
    monkeypatch.setattr(asyncio, "wait_for", timeout)
    provider = ExistingLlmCandidateProvider(
        timeout_seconds=5, maximum_output_bytes=10_000
    )
    with pytest.raises(ProcessingJobFailure) as error:
        _run(provider.propose('{"segments":[]}'))
    assert error.value.code == "candidate_provider_timeout"
    assert error.value.retryable is True


def test_feature_flags_default_off_and_storage_backend_is_bounded(monkeypatch):
    for name in (
        "ENABLE_VIRAL_CANDIDATE_ANALYSIS",
        "ENABLE_SMART_REFRAME",
        "AUTOMATIC_CLIPPER_STORAGE_BACKEND",
    ):
        monkeypatch.delenv(name, raising=False)
    config = AutomaticClipperConfig.from_env()
    assert config.candidate_analysis_enabled is False
    assert config.smart_reframe_enabled is False
    monkeypatch.setenv("AUTOMATIC_CLIPPER_STORAGE_BACKEND", "remote-arbitrary")
    with pytest.raises(JobOrchestrationError) as error:
        AutomaticClipperConfig.from_env()
    assert error.value.category == "worker_not_configured"


def test_face_detector_missing_asset_is_a_safe_optional_fallback():
    detector, module, version = _detector(Path("missing-face-model.tflite"))
    assert detector is None
    assert module is None
    assert version is None
