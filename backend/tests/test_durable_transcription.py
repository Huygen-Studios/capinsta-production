import asyncio
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext
from server.clipping_storage.local_storage import LocalMediaStorage
from server.durable_transcription.config import DurableTranscriptionConfig
from server.durable_transcription.contracts import (
    TranscriptionJobInputV1,
    TranscriptionJobResultV1,
)
from server.durable_transcription.handler import TranscriptionJobHandler
from server.durable_transcription.identity import (
    transcript_result_identity,
    transcription_request_identity,
)
from server.durable_transcription.normalization import (
    build_transcript_document_v2,
)
from server.durable_transcription.pipeline import _classify_pipeline_error
from server.durable_transcription.registration import (
    register_durable_transcription_if_enabled,
)
from server.durable_transcription.source import (
    materialize_transcription_source,
)
from server.clipping_jobs.registry import JobHandlerRegistry
from server.clipping_storage.models import ProbeSource
from server.transcription_control import TranscriptionConfigSnapshot


def _run(coro):
    return asyncio.run(coro)


def _context(**changes):
    async def heartbeat(**kwargs):
        return kwargs

    async def cancelled():
        return False

    values = {
        "job_id": uuid4(),
        "attempt_number": 1,
        "worker_id": "worker-test",
        "claim_token": uuid4(),
        "heartbeat_callback": heartbeat,
        "cancellation_callback": cancelled,
        "shutdown_event": asyncio.Event(),
        "maximum_attempts": 3,
        "execution_timeout_seconds": 60,
    }
    values.update(changes)
    return JobExecutionContext(**values)


def _payload(*, hotwords=None, provider="sarvam"):
    media_id = uuid4()
    variant_id = uuid4()
    options = {
        "wordTimestamps": True,
        "speakerLabels": False,
        "preserveFillers": True,
    }
    identity = transcription_request_identity(
        media_asset_id=media_id,
        media_revision=3,
        storage_object_revision=1,
        audio_variant_id=variant_id,
        audio_variant_revision=2,
        language_mode="hinglish",
        provider_preference=provider,
        hotwords=hotwords or [],
        options=options,
    )
    return {
        "schemaVersion": 1,
        "jobType": "transcription",
        "mediaAssetId": str(media_id),
        "expectedMediaRevision": 3,
        "storageObjectRevision": 1,
        "audioVariantId": str(variant_id),
        "audioVariantRevision": 2,
        "transcriptId": f"tr_{identity[:32]}",
        "requestIdentity": identity,
        "languageMode": "hinglish",
        "providerPreference": provider,
        "hotwords": hotwords or [],
        "options": options,
        "metadata": {},
    }


def _normalized(*, untimed=False, overlap=False, speaker=False):
    return {
        "detectedLanguage": "hi-en",
        "timingProvenance": "provider_word",
        "romanized": True,
        "segments": [
            {
                "start": 0.1,
                "end": 0.8,
                "text": "Hello bhai",
                "originalText": "hello bhai",
                **({"speakerId": "speaker_a"} if speaker else {}),
                "words": [
                    {
                        "word": "Hello",
                        "originalWord": "hello",
                        "start": None if untimed else 0.1,
                        "end": None if untimed else 0.4,
                        "confidence": 0.92,
                        "timing_source": "provider_word",
                    },
                    {
                        "word": "bhai",
                        "start": None if untimed else 0.45,
                        "end": None if untimed else 0.8,
                        "confidence": 0.4,
                        "timing_source": "provider_word",
                    },
                ],
            },
            *(
                [
                    {
                        "start": 0.7,
                        "end": 1.0,
                        "text": "Overlap",
                        "speakerId": "speaker_b",
                        "words": [],
                    }
                ]
                if overlap
                else []
            ),
        ],
    }


def _document(**changes):
    values = {
        "transcript_id": "tr_test",
        "media_id": str(uuid4()),
        "duration_ms": 1000,
        "language_mode": "hinglish",
        "provider_name": "sarvam",
        "provider_model": "saaras:v3",
        "configuration_snapshot": {
            "configuration_id": "cfg",
            "version": 4,
            "timestamp_strategy": "word",
        },
        "created_at": datetime(2026, 7, 25, tzinfo=timezone.utc),
    }
    values.update(changes)
    return build_transcript_document_v2(_normalized(), **values)


def test_input_contract_rejects_untrusted_fields_and_identity_tampering():
    payload = _payload()
    TranscriptionJobInputV1.model_validate(payload)
    with pytest.raises(ValidationError):
        TranscriptionJobInputV1.model_validate(
            {**payload, "sourceUrl": "https://private.invalid/audio.wav"}
        )
    with pytest.raises(ValidationError):
        TranscriptionJobInputV1.model_validate(
            {**payload, "metadata": {"filePath": "C:/secret.wav"}}
        )
    with pytest.raises(JobOrchestrationError) as error:
        handler = object.__new__(TranscriptionJobHandler)
        handler.config = DurableTranscriptionConfig(maximum_hotwords=50)
        handler._input({**payload, "requestIdentity": "0" * 64})
    assert error.value.category == "invalid_handler_input"


def test_hotwords_are_bounded_deduplicated_and_do_not_enter_metadata():
    payload = _payload(hotwords=[" Capinsta ", "capinsta", "mixed phrase"])
    parsed = TranscriptionJobInputV1.model_validate(payload)
    assert parsed.hotwords == ["Capinsta", "mixed phrase"]
    assert parsed.metadata == {}
    with pytest.raises(ValidationError):
        TranscriptionJobInputV1.model_validate(
            {**payload, "hotwords": ["x" * 101]}
        )


def test_normalization_preserves_text_timing_confidence_and_provenance():
    document, warnings = _document()
    assert document.segments[0].text == "Hello bhai"
    assert document.segments[0].originalText == "hello bhai"
    assert (document.words[0].startMs, document.words[0].endMs) == (100, 400)
    assert document.words[0].originalText == "hello"
    assert document.words[0].confidence == 0.92
    assert document.words[0].timingSource == "provider"
    assert document.words[1].isLowConfidence is True
    assert "provider_text_normalized" in warnings


@pytest.mark.parametrize(
    ("changes", "warning"),
    [
        ({"transcript": _normalized(untimed=True)}, "untimed_word_preserved"),
        (
            {"transcript": _normalized(overlap=True, speaker=True)},
            "overlapping_segments_preserved",
        ),
    ],
)
def test_normalization_preserves_missing_timing_and_overlaps(changes, warning):
    transcript = changes.pop("transcript")
    values = {
        "transcript_id": "tr_test",
        "media_id": str(uuid4()),
        "duration_ms": 1000,
        "language_mode": "auto",
        "provider_name": "sarvam",
        "provider_model": "saaras:v3",
        "configuration_snapshot": {},
        "created_at": datetime(2026, 7, 25, tzinfo=timezone.utc),
        **changes,
    }
    document, warnings = build_transcript_document_v2(transcript, **values)
    assert warning in warnings
    if warning == "untimed_word_preserved":
        assert document.words[0].startMs is None
        assert document.words[0].endMs is None
    else:
        assert document.quality.overlapCount == 1
        assert {speaker.id for speaker in document.speakers} == {
            "speaker_a",
            "speaker_b",
        }


def test_normalization_rejects_invalid_provider_timing_and_confidence():
    bad = _normalized()
    bad["segments"][0]["end"] = 1.2
    with pytest.raises(ValueError, match="exceeds media duration"):
        build_transcript_document_v2(
            bad,
            transcript_id="tr_test",
            media_id=str(uuid4()),
            duration_ms=1000,
            language_mode="auto",
            provider_name="sarvam",
            provider_model="saaras:v3",
            configuration_snapshot={},
            created_at=datetime.now(timezone.utc),
        )
    bad = _normalized()
    bad["segments"][0]["words"][0]["confidence"] = 1.1
    with pytest.raises(ValueError, match="outside 0..1"):
        build_transcript_document_v2(
            bad,
            transcript_id="tr_test",
            media_id=str(uuid4()),
            duration_ms=1000,
            language_mode="auto",
            provider_name="sarvam",
            provider_model="saaras:v3",
            configuration_snapshot={},
            created_at=datetime.now(timezone.utc),
        )


def test_result_identity_ignores_audit_timestamps_but_not_content():
    document, _ = _document()
    raw = document.model_dump(mode="json")
    identity = transcript_result_identity(raw)
    changed = {**raw, "updatedAt": "2030-01-01T00:00:00Z"}
    assert transcript_result_identity(changed) == identity
    changed["segments"][0]["text"] = "Changed"
    assert transcript_result_identity(changed) != identity


def test_result_contract_rejects_inconsistent_counts_and_sensitive_metadata():
    payload = {
        "schemaVersion": 1,
        "transcriptId": "tr_test",
        "mediaAssetId": str(uuid4()),
        "mediaRevision": 1,
        "audioVariantId": str(uuid4()),
        "provider": {"name": "sarvam", "model": "saaras:v3"},
        "language": {"requestedMode": "auto", "detected": None},
        "durationMs": 1,
        "segmentCount": 0,
        "wordCount": 1,
        "timedWordCount": 0,
        "untimedWordCount": 1,
        "speakerCount": None,
        "timingSource": "unknown",
        "warnings": [],
        "resultIdentity": "0" * 64,
        "metadata": {},
    }
    TranscriptionJobResultV1.model_validate(payload)
    with pytest.raises(ValidationError):
        TranscriptionJobResultV1.model_validate(
            {**payload, "untimedWordCount": 0}
        )
    with pytest.raises(ValidationError):
        TranscriptionJobResultV1.model_validate(
            {**payload, "metadata": {"sourceUrl": "https://secret.invalid"}}
        )


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("HTTP 429 rate limit", ("transcription_provider_rate_limited", True)),
        ("request timed out", ("transcription_provider_timeout", True)),
        ("401 API key invalid", ("transcription_provider_auth_failed", False)),
        (
            "unsupported language",
            ("transcription_provider_language_unsupported", False),
        ),
        (
            "invalid response",
            ("transcription_provider_response_invalid", False),
        ),
        ("HTTP 503", ("transcription_provider_unavailable", True)),
    ],
)
def test_provider_failure_classification(message, expected):
    assert _classify_pipeline_error(message) == expected


def test_local_source_is_copied_to_attempt_workspace(tmp_path):
    source = tmp_path / "storage" / "source.wav"
    source.parent.mkdir()
    source.write_bytes(b"RIFF-synthetic")
    workspace = tmp_path / "attempt"
    workspace.mkdir()
    copied = _run(
        materialize_transcription_source(
            ProbeSource("local_path", str(source), None, "[private]"),
            context=_context(),
            workspace=workspace,
            config=DurableTranscriptionConfig(maximum_source_bytes=1000),
        )
    )
    assert copied == workspace / "audio.wav"
    assert copied.read_bytes() == source.read_bytes()
    assert copied.resolve() != source.resolve()


class _FakeRepository:
    def __init__(self, target):
        self.target = target
        self.finalized = None
        self.failed = None
        self.normalized = False

    async def begin(self, context, job_input):
        return self.target

    async def mark_normalizing(self, context, job_input):
        self.normalized = True

    async def finalize_success(self, context, job_input, *, document, result):
        self.finalized = (document, result)
        return result.model_dump(mode="json")

    async def finalize_permanent_failure(
        self, context, job_input, failure
    ):
        self.failed = failure

    async def release_after_cancellation(self, context, job_input):
        return None


class _FakePipeline:
    def __init__(self, value=None, failure=None):
        self.value = value or _normalized()
        self.failure = failure
        self.audio_path = None
        self.called = False

    async def transcribe(self, *, audio_path, **kwargs):
        self.called = True
        self.audio_path = audio_path
        assert audio_path.name == "audio.wav"
        if self.failure:
            raise self.failure
        return self.value


def _handler_parts(tmp_path, *, pipeline=None):
    payload = _payload()
    parsed = TranscriptionJobInputV1.model_validate(payload)
    storage = LocalMediaStorage(tmp_path / "storage")
    object_path = (
        Path(str(uuid4()))
        / str(parsed.mediaAssetId)
        / "variants"
        / "audio_extract"
        / "r3"
        / ("a" * 12)
        / "audio.wav"
    )
    source = storage.root / "media-variants" / object_path
    source.parent.mkdir(parents=True)
    source.write_bytes(b"RIFF-synthetic-audio")
    target = {
        "asset": {"duration_ms": 1000},
        "variant": {
            "storage_bucket": "media-variants",
            "storage_path": object_path.as_posix(),
            "size_bytes": source.stat().st_size,
        },
        "transcript": {
            "created_at": datetime(2026, 7, 25, tzinfo=timezone.utc)
        },
        "existingDocument": None,
    }
    repository = _FakeRepository(target)
    snapshot = TranscriptionConfigSnapshot(
        configuration_id="cfg",
        provider="sarvam",
        model="saaras:v3",
        version=1,
        provider_options={},
        timestamp_strategy="word",
    )
    handler = TranscriptionJobHandler(
        config=DurableTranscriptionConfig(
            enabled=True,
            temp_root=tmp_path / "work",
            storage_backend="local",
            local_storage_root=str(storage.root),
            maximum_source_bytes=10_000_000,
        ),
        storage=storage,
        repository=repository,
        configuration_snapshot=snapshot,
        pipeline=pipeline or _FakePipeline(),
    )
    return handler, repository, payload, source


def test_handler_success_persists_bounded_v2_and_safe_summary(tmp_path):
    pipeline = _FakePipeline()
    handler, repository, payload, source = _handler_parts(
        tmp_path, pipeline=pipeline
    )
    result = _run(handler.execute(_context(), payload))
    assert result.finalized is True
    document, summary = repository.finalized
    assert document["schemaVersion"] == 2
    assert document["words"][0]["startMs"] == 100
    assert summary.segmentCount == 1
    assert "segments" not in result.output
    assert "source" not in result.output
    assert pipeline.audio_path.resolve() != source.resolve()
    assert source.exists()
    assert not any((tmp_path / "work").iterdir())


def test_handler_classifies_terminal_provider_failure_and_finalizes(tmp_path):
    failure = ProcessingJobFailure(
        "transcription_provider_response_invalid",
        "Safe failure",
        retryable=False,
    )
    handler, repository, payload, _ = _handler_parts(
        tmp_path, pipeline=_FakePipeline(failure=failure)
    )
    with pytest.raises(ProcessingJobFailure) as error:
        _run(handler.execute(_context(), payload))
    assert error.value.finalized is True
    assert repository.failed is failure


def test_handler_leaves_retryable_failure_for_worker_retry(tmp_path):
    failure = ProcessingJobFailure(
        "transcription_provider_unavailable",
        "Safe retry",
        retryable=True,
    )
    handler, repository, payload, _ = _handler_parts(
        tmp_path, pipeline=_FakePipeline(failure=failure)
    )
    with pytest.raises(ProcessingJobFailure) as error:
        _run(handler.execute(_context(attempt_number=1), payload))
    assert error.value.retryable is True
    assert repository.failed is None


def test_handler_cancellation_before_provider_call(tmp_path):
    pipeline = _FakePipeline()
    handler, repository, payload, _ = _handler_parts(
        tmp_path, pipeline=pipeline
    )
    context = _context()
    context.shutdown_event.set()
    with pytest.raises(asyncio.CancelledError):
        _run(handler.execute(context, payload))
    assert pipeline.called is False
    assert repository.finalized is None


def test_registration_is_disabled_by_default_without_provider_config(
    monkeypatch,
):
    monkeypatch.delenv(
        "ENABLE_DURABLE_TRANSCRIPTION_HANDLER", raising=False
    )
    monkeypatch.setenv("TRANSCRIPTION_HANDLER_TIMEOUT_SECONDS", "invalid")
    registry = JobHandlerRegistry()
    assert (
        _run(
            register_durable_transcription_if_enabled(
                registry, database=object()
            )
        )
        is None
    )
    assert "transcription" not in registry.supported_job_types
