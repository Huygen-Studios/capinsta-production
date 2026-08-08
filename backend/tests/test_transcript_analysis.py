import asyncio
import copy
import json
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from backend.contracts.transcript_document_v2 import TranscriptDocumentV2
from server.clipping_jobs.models import JobExecutionContext
from server.transcript_analysis.config import TranscriptAnalysisConfig
from server.transcript_analysis.contracts import (
    SilenceAnalysisDocumentV1,
    SilenceAnalysisJobInputV1,
    TimelineRecommendationV1,
    TranscriptAnalysisJobInputV1,
)
from server.transcript_analysis.handlers import TranscriptAnalysisJobHandler
from server.transcript_analysis.identity import analysis_identity, canonical_hash
from server.transcript_analysis.presets import TRANSCRIPT_REVIEW_SPEC_HASH
from server.transcript_analysis.silence import (
    SilenceFFmpegRunner,
    build_silence_document,
    decimal_seconds_to_ms,
    parse_silencedetect,
    silence_recommendations,
)
from server.transcript_analysis.transcript_review import analyze_transcript
from server.transcript_analysis.registration import register_transcript_analysis_if_enabled
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_persistence.database import DurableDatabase
from server.clipping_jobs.errors import JobOrchestrationError

ROOT = Path(__file__).parents[2]


def _document(name="english-words.json"):
    return TranscriptDocumentV2.model_validate_json(
        (ROOT / "contracts/fixtures/transcript-document-v2" / name).read_text("utf-8")
    )


def _context(**changes):
    async def heartbeat(**kwargs):
        return kwargs

    async def cancelled():
        return False

    values = dict(
        job_id=uuid4(),
        attempt_number=1,
        worker_id="test",
        claim_token=uuid4(),
        heartbeat_callback=heartbeat,
        cancellation_callback=cancelled,
        shutdown_event=asyncio.Event(),
        maximum_attempts=3,
        execution_timeout_seconds=60,
    )
    values.update(changes)
    return JobExecutionContext(**values)


def test_identity_is_canonical_and_revision_bound():
    first = canonical_hash({"b": 2, "a": 1})
    assert first == canonical_hash({"a": 1, "b": 2})
    common = dict(
        media_asset_id="11111111-1111-1111-1111-111111111111",
        media_revision=1,
        transcript_id="tr_test",
        transcript_revision=1,
        analysis_type="transcript_review",
        spec_hash=first,
    )
    assert analysis_identity(**common) == analysis_identity(**common)
    assert analysis_identity(**common) != analysis_identity(**{**common, "transcript_revision": 2})


def test_typed_inputs_reject_unknown_kinds_paths_and_versions():
    payload = dict(
        schemaVersion=1,
        analysisId="analysis_test",
        mediaAssetId=uuid4(),
        expectedMediaRevision=1,
        transcriptId="tr_test",
        expectedTranscriptRevision=1,
        analysisSpecHash="a" * 64,
        analysisKinds=["confidence"],
        preset="transcript-review-v1",
    )
    TranscriptAnalysisJobInputV1.model_validate(payload)
    with pytest.raises(ValidationError):
        TranscriptAnalysisJobInputV1.model_validate({**payload, "schemaVersion": 2})
    with pytest.raises(ValidationError):
        TranscriptAnalysisJobInputV1.model_validate({**payload, "analysisKinds": ["magic"]})
    with pytest.raises(ValidationError):
        TranscriptAnalysisJobInputV1.model_validate({**payload, "localPath": "secret.wav"})


@pytest.mark.parametrize(
    ("value", "expected"),
    [("0.0005", 1), ("1.2344", 1234), ("1.2345", 1235)],
)
def test_decimal_timestamp_rounds_half_up(value, expected):
    assert decimal_seconds_to_ms(value) == expected


def test_silence_parser_normalizes_leading_middle_trailing_and_merge():
    raw = "\n".join(
        [
            "silence_start: 0",
            "silence_end: 0.6 | silence_duration: 0.6",
            "silence_start: 1.5",
            "silence_end: 2.1 | silence_duration: 0.6",
            "silence_start: 2.15",
            "silence_end: 2.8 | silence_duration: 0.65",
            "silence_start: 3.5",
        ]
    )
    intervals, warnings = parse_silencedetect(
        raw, duration_ms=4200, minimum_duration_ms=500, merge_gap_ms=100
    )
    assert [(x.sourceStartMs, x.sourceEndMs) for x in intervals] == [
        (0, 600),
        (1500, 2800),
        (3500, 4200),
    ]
    assert warnings == [
        "adjacent_silence_intervals_merged",
        "trailing_silence_closed_at_duration",
    ]
    assert [item.id for item in intervals] == [
        "silence_000001", "silence_000002", "silence_000003"
    ]


@pytest.mark.parametrize(
    "raw",
    [
        "silence_start: -0.1",
        "silence_start: 2.1",
        "silence_start: 0.2\nsilence_start: 0.4",
        "silence_start: 1.0\nsilence_end: 0.5 | silence_duration: 0.1",
        (
            "silence_start: 0\nsilence_end: 1.0 | silence_duration: 1.0\n"
            "silence_start: 0.5\nsilence_end: 1.5 | silence_duration: 1.0"
        ),
    ],
)
def test_silence_parser_rejects_bad_events(raw):
    with pytest.raises(ValueError):
        parse_silencedetect(raw, duration_ms=2000, minimum_duration_ms=100, merge_gap_ms=0)


def test_silence_recommendation_padding_and_word_overlap_protection():
    transcript = _document()
    intervals, _ = parse_silencedetect(
        "silence_start: 0\nsilence_end: 0.8 | silence_duration: 0.8",
        duration_ms=transcript.durationMs,
        minimum_duration_ms=500,
        merge_gap_ms=100,
    )
    doc = build_silence_document(
        analysis_id="analysis_test",
        media_asset_id=uuid4(),
        media_revision=1,
        transcript_id=transcript.transcriptId,
        transcript_revision=1,
        audio_variant_id=uuid4(),
        audio_variant_revision=1,
        duration_ms=transcript.durationMs,
        intervals=intervals,
        warnings=[],
    )
    recommendations, warnings = silence_recommendations(
        doc, transcript, edge_padding_ms=100, minimum_retained_speech_ms=250
    )
    assert recommendations == []
    assert "silence_overlaps_transcript_word" in warnings


def test_filler_confidence_timing_findings_are_deterministic_and_non_mutating():
    transcript = _document("low-confidence.json")
    original = transcript.model_dump(mode="json")
    first = analyze_transcript(
        transcript,
        analysis_id="analysis_test",
        media_asset_id=uuid4(),
        media_revision=1,
        transcript_revision=1,
        kinds=["confidence", "fillers", "timing_quality"],
    )
    second = analyze_transcript(
        transcript,
        analysis_id="analysis_test",
        media_asset_id=first[0].mediaAssetId,
        media_revision=1,
        transcript_revision=1,
        kinds=["confidence", "fillers", "timing_quality"],
    )
    assert first[0].model_dump(mode="json") == second[0].model_dump(mode="json")
    assert [x.model_dump(mode="json") for x in first[1]] == [
        x.model_dump(mode="json") for x in second[1]
    ]
    assert transcript.model_dump(mode="json") == original
    assert all(item.recommendationType != "remove_silence" for item in first[1])


def test_exact_filler_matching_punctuation_repeats_and_substrings():
    payload = _document().model_dump(mode="json")
    payload["languageMode"] = "english"
    payload["segments"][0]["text"] = "Um, yummy uh"
    payload["segments"][0]["originalText"] = "Um, yummy uh"
    words = payload["words"]
    for index, text in enumerate(["Um,", "yummy", "uh"]):
        source = copy.deepcopy(words[min(index, len(words) - 1)])
        source["id"] = f"word_{index + 1:06d}"
        source["text"] = text
        source["originalText"] = text
        source["segmentId"] = payload["segments"][0]["id"]
        source["startMs"] = index * 300
        source["endMs"] = index * 300 + 200
        words[index if index < len(words) else -1] = source
    payload["words"] = words[:3]
    payload["segments"][0]["wordIds"] = [x["id"] for x in payload["words"]]
    transcript = TranscriptDocumentV2.model_validate(payload)
    result, _ = analyze_transcript(
        transcript,
        analysis_id="analysis_test",
        media_asset_id=uuid4(),
        media_revision=1,
        transcript_revision=1,
        kinds=["fillers"],
    )
    assert [f.wordIds for f in result.findings] == [["word_000001"], ["word_000003"]]


def test_missing_confidence_warns_but_is_not_low_confidence():
    payload = _document().model_dump(mode="json")
    for word in payload["words"]:
        word["confidence"] = None
        word["isLowConfidence"] = False
    transcript = TranscriptDocumentV2.model_validate(payload)
    result, _ = analyze_transcript(
        transcript,
        analysis_id="analysis_test",
        media_asset_id=uuid4(),
        media_revision=1,
        transcript_revision=1,
        kinds=["confidence"],
    )
    assert result.summary.lowConfidenceWordCount == 0
    assert result.warnings == ["confidence_missing"]


def test_recommendation_contract_forbids_zero_length_and_executable_action():
    base = dict(
        recommendationId="rec_test",
        analysisId="analysis_test",
        recommendationType="remove_silence",
        sourceStartMs=10,
        sourceEndMs=10,
        reasonCode="silence_exceeds_threshold",
        severity="suggestion",
        proposedAction={"action": "exclude_source_interval"},
    )
    with pytest.raises(ValidationError):
        TimelineRecommendationV1.model_validate(base)
    with pytest.raises(ValidationError):
        TimelineRecommendationV1.model_validate(
            {**base, "sourceEndMs": 20, "proposedAction": {"action": "run_ffmpeg"}}
        )


class _FakeRepository:
    def __init__(self, transcript):
        self.transcript = transcript
        self.finalized = None

    async def begin(self, context, value):
        return {}, {}, {}, None, self.transcript

    async def mark_normalizing(self, context, value):
        return None

    async def finalize_success(self, context, value, **kwargs):
        self.finalized = kwargs
        return kwargs["result"].model_dump(mode="json")

    async def release_after_cancellation(self, context, value):
        return None


def test_transcript_handler_success_and_cancellation():
    transcript = _document()
    repository = _FakeRepository(transcript)
    handler = TranscriptAnalysisJobHandler(
        config=TranscriptAnalysisConfig(handlers_enabled=True),
        repository=repository,
    )
    payload = TranscriptAnalysisJobInputV1(
        analysisId="analysis_test",
        mediaAssetId=uuid4(),
        expectedMediaRevision=1,
        transcriptId=transcript.transcriptId,
        expectedTranscriptRevision=1,
        analysisSpecHash=TRANSCRIPT_REVIEW_SPEC_HASH,
        analysisKinds=["confidence", "fillers", "timing_quality"],
        preset="transcript-review-v1",
    ).model_dump(mode="json")
    result = asyncio.run(handler.execute(_context(), payload))
    assert result.finalized
    assert repository.finalized is not None
    context = _context()
    context.cancellation_event.set()
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(handler.execute(context, payload))


def test_registration_is_disabled_by_default_and_transcript_only_needs_no_ffmpeg(monkeypatch):
    monkeypatch.delenv("ENABLE_TRANSCRIPT_ANALYSIS_HANDLERS", raising=False)
    monkeypatch.setenv("TRANSCRIPT_ANALYSIS_JOB_TYPES", "not-a-real-job")
    registry = JobHandlerRegistry()
    assert asyncio.run(
        register_transcript_analysis_if_enabled(
            registry, DurableDatabase("postgresql://unused")
        )
    ) is None
    monkeypatch.setenv("ENABLE_TRANSCRIPT_ANALYSIS_HANDLERS", "true")
    monkeypatch.setenv("TRANSCRIPT_ANALYSIS_JOB_TYPES", "transcript_analysis")
    registered = asyncio.run(
        register_transcript_analysis_if_enabled(
            registry, DurableDatabase("postgresql://unused")
        )
    )
    assert registered == ("transcript_analysis",)


def test_registration_rejects_unknown_enabled_job_type(monkeypatch):
    monkeypatch.setenv("ENABLE_TRANSCRIPT_ANALYSIS_HANDLERS", "true")
    monkeypatch.setenv("TRANSCRIPT_ANALYSIS_JOB_TYPES", "highlight_analysis")
    with pytest.raises(JobOrchestrationError):
        asyncio.run(
            register_transcript_analysis_if_enabled(
                JobHandlerRegistry(), DurableDatabase("postgresql://unused")
            )
        )


def test_silence_runner_terminates_on_cancellation(monkeypatch, tmp_path):
    class FakeStderr:
        async def read(self, size=-1):
            del size
            await asyncio.Event().wait()

    class FakeProcess:
        def __init__(self):
            self.stderr = FakeStderr()
            self.returncode = None
            self.pid = None
            self.terminated = False

        async def wait(self):
            while self.returncode is None:
                await asyncio.sleep(0.01)
            return self.returncode

        def terminate(self):
            self.terminated = True
            self.returncode = -1

        def kill(self):
            self.returncode = -9

    process = FakeProcess()

    async def create(*args, **kwargs):
        del args, kwargs
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create)

    async def cancelled():
        return True

    context = _context(cancellation_callback=cancelled)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            SilenceFFmpegRunner("ffmpeg").detect(
                tmp_path / "audio.wav",
                context=context,
                noise_threshold_db=-35,
                minimum_duration_ms=500,
                timeout_seconds=10,
            )
        )
    assert process.terminated


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg unavailable")
def test_real_ffmpeg_silence_is_repeatable(tmp_path):
    path = tmp_path / "synthetic.wav"
    subprocess.run(
        [
            shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i",
            "aevalsrc=if(between(t\\,0.5\\,1.5)+between(t\\,2.2\\,3.2)\\,0.5*sin(2*PI*440*t)\\,0):s=16000:d=3.6",
            str(path),
        ],
        check=True,
    )
    runner = SilenceFFmpegRunner()
    context = _context(execution_timeout_seconds=20)
    raw_one = asyncio.run(
        runner.detect(
            path, context=context, noise_threshold_db=-35,
            minimum_duration_ms=500, timeout_seconds=20,
        )
    )
    raw_two = asyncio.run(
        runner.detect(
            path, context=_context(execution_timeout_seconds=20),
            noise_threshold_db=-35, minimum_duration_ms=500, timeout_seconds=20,
        )
    )
    one = parse_silencedetect(raw_one, duration_ms=3600, minimum_duration_ms=500, merge_gap_ms=100)
    two = parse_silencedetect(raw_two, duration_ms=3600, minimum_duration_ms=500, merge_gap_ms=100)
    assert one == two
    assert [(x.sourceStartMs, x.sourceEndMs) for x in one[0]] == pytest.approx(
        [(0, 500), (1500, 2200)], abs=3
    )
