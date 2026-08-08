import asyncio
import pytest

import ai_pipeline.transcriber as transcriber
import ai_pipeline.timing as timing
import server.api.admin as admin_api
from server.transcription_catalog import TRANSCRIPTION_PROVIDER_CATALOG, model_runtime_availability, public_catalog
from server import transcription_control


def test_openai_whisper_request_uses_verbose_json_and_word_segments():
    kwargs = transcriber._openai_transcription_request_kwargs(
        file=object(),
        filename="audio.mp3",
        mime_type="audio/mpeg",
        model="whisper-1",
        language_hint="en",
        prompt="prompt",
    )

    assert kwargs["model"] == "whisper-1"
    assert kwargs["response_format"] == "verbose_json"
    assert kwargs["timestamp_granularities"] == ["word", "segment"]
    assert kwargs["language"] == "en"
    assert kwargs["prompt"] == "prompt"


@pytest.mark.parametrize("model", ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"])
def test_openai_gpt4o_transcription_models_do_not_receive_whisper_only_parameters(model):
    kwargs = transcriber._openai_transcription_request_kwargs(
        file=object(),
        filename="audio.mp3",
        mime_type="audio/mpeg",
        model=model,
        language_hint="en",
        prompt="prompt",
    )

    assert kwargs["model"] == model
    assert kwargs["response_format"] == "json"
    assert "timestamp_granularities" not in kwargs
    assert kwargs["response_format"] != "verbose_json"


def test_sarvam_timestamp_validation_is_structural_not_transcript_token_coverage(tmp_path):
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"RIFF....WAVEfmt " + b"\0" * 128)
    result = {
        "text": "one two three four five six seven eight nine ten",
        "words": [
            {"word": "१२३", "start": 0.0, "end": 0.4, "provider": "sarvam"},
            {"word": "hello-world", "start": 0.5, "end": 0.9, "provider": "sarvam"},
        ],
    }

    validated = transcriber._validate_transcription_result(result, "sarvam", str(audio), timestamp_strategy="provider_word")

    assert [word["word"] for word in validated["words"]] == ["१२३", "hello-world"]


def test_sarvam_mismatched_timestamp_arrays_are_rejected():
    with pytest.raises(transcriber.TranscriptionProviderError) as exc:
        transcriber._normalize_sarvam_words(
            {
                "timestamps": {
                    "words": ["hello", "world"],
                    "start_time_seconds": [0.0],
                    "end_time_seconds": [0.4, 0.9],
                }
            }
        )

    assert exc.value.category == "sarvam_timestamp_array_length_mismatch"


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (400, "invalid_request"),
        (401, "authentication_failed"),
        (403, "permission_denied"),
        (404, "model_not_found"),
        (429, "rate_limited"),
        (500, "provider_unavailable"),
        (503, "provider_unavailable"),
        (504, "provider_unavailable"),
    ],
)
def test_gemini_error_categories_are_normalized(status, expected):
    assert transcriber._gemini_error_category(status) == expected


def test_strict_snapshot_never_tries_another_provider(monkeypatch, tmp_path):
    calls = []
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"RIFF....WAVEfmt " + b"\0" * 128)

    def fake_call(provider, audio_path, mode, *, transcription_config_snapshot=None):
        calls.append((provider, transcription_config_snapshot.model))
        raise transcriber.TranscriptionProviderError(provider, "provider_unavailable", status=503)

    monkeypatch.setattr(transcriber, "_provider_key_available", lambda provider: True)
    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    monkeypatch.setattr(
        timing,
        "alignment_provider_status",
        lambda: {
            "realForcedAlignmentAvailable": True,
            "forcedAlignmentUnavailableReasons": [],
        },
    )

    with pytest.raises(RuntimeError) as exc:
        transcriber.transcribe_audio(
            str(audio),
            "english",
            transcription_config_snapshot={
                "configuration_id": "cfg",
                "provider": "openai",
                "model": "gpt-4o-mini-transcribe",
                "version": 7,
                "provider_options": {},
                "timestamp_strategy": "local_forced_alignment",
                "strict_provider": True,
            },
        )

    assert calls == [("openai", "gpt-4o-mini-transcribe")]
    assert "All configured transcription providers failed" not in str(exc.value)


def test_production_no_active_db_config_bootstraps_from_existing_env(monkeypatch):
    monkeypatch.setattr(transcription_control, "psycopg", None)
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.delenv("STT_PROVIDER", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "real-gemini-key")
    monkeypatch.setenv("SARVAM_API_KEY", "real-sarvam-key")
    transcription_control.invalidate_transcription_config_cache()

    snapshot = transcription_control.active_transcription_config()

    assert snapshot is not None
    assert snapshot.configuration_id == "env-bootstrap"
    assert snapshot.provider == "sarvam"
    assert snapshot.model == "saaras:v3"


def test_alignment_required_models_are_not_production_ready_without_aligner(monkeypatch):
    monkeypatch.setattr(
        timing,
        "alignment_provider_status",
        lambda: {
            "realForcedAlignmentAvailable": False,
            "forcedAlignmentUnavailableReasons": ["forced_alignment_disabled"],
        },
    )

    catalog = public_catalog()
    unavailable = [
        item
        for item in catalog
        if item["model"] in {"gemini-2.5-flash", "gemini-3.5-flash", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"}
    ]

    assert unavailable
    assert all(item["productionReady"] is False for item in unavailable)
    assert all(item["reason"] == "forced_alignment_unavailable" for item in unavailable)


def test_native_timing_models_remain_production_ready_without_aligner(monkeypatch):
    monkeypatch.setattr(
        timing,
        "alignment_provider_status",
        lambda: {
            "realForcedAlignmentAvailable": False,
            "forcedAlignmentUnavailableReasons": ["forced_alignment_disabled"],
        },
    )

    entries = {entry.model: model_runtime_availability(entry) for entry in TRANSCRIPTION_PROVIDER_CATALOG}

    assert entries["saaras:v3"]["productionReady"] is True
    assert entries["whisper-1"]["productionReady"] is True


def test_admin_configuration_test_runs_stable_ts_fallback_for_sarvam_phrase_timing(monkeypatch):
    class AdminContext:
        correlation_id = "corr-test"

    monkeypatch.setattr(admin_api, "require_backend_admin_permission", lambda *_args, **_kwargs: AdminContext())
    monkeypatch.setattr(admin_api, "is_real_secret", lambda _value: True)
    monkeypatch.setenv("SARVAM_API_KEY", "real-sarvam-key")
    monkeypatch.setattr(admin_api, "bundled_test_audio_path", lambda: "audio.wav")
    monkeypatch.setattr(
        admin_api,
        "transcribe_audio",
        lambda *_args, **_kwargs: {
            "text": "hello world",
            "duration": 1.0,
            "provider": "sarvam",
            "words": [
                {
                    "word": "hello world",
                    "start": 0.0,
                    "end": 1.0,
                    "timingSource": "provider_phrase",
                    "preservePhraseTiming": True,
                }
            ],
            "nativeWordsAvailable": False,
            "nativeTimingFailureCategory": "sarvam_phrase_timestamps",
            "nativeTimingFailureMessage": "Sarvam returned phrase-level timestamps instead of native word timestamps.",
            "nativeWordCount": 0,
            "phraseEntryCount": 1,
            "timing_granularity": "phrase",
            "provider_request_id": "sarvam-req",
        },
    )
    monkeypatch.setattr(
        admin_api,
        "align_text",
        lambda *_args, **_kwargs: [
            {
                "text": "hello world",
                "start": 0.0,
                "end": 1.0,
                "words": [
                    {"word": "hello", "start": 0.0, "end": 0.4},
                    {"word": "world", "start": 0.5, "end": 1.0},
                ],
            }
        ],
    )

    class StableResult:
        report = {"applied": True, "appliedWords": 2, "reason": "token match timing transfer"}
        segments = []

    monkeypatch.setattr(admin_api, "apply_stable_refinement", lambda *_args, **_kwargs: StableResult())

    response = asyncio.run(
        admin_api.transcription_test_config(
            admin_api.TranscriptionTestRequest(
                configurationId="cfg",
                provider="sarvam",
                model="saaras:v3",
                version=1,
                timestampStrategy="provider_word",
                strictProvider=True,
                providerOptions={},
                pipelineOptions={
                    "timingSourcePolicy": "native_then_forced",
                    "alignment": {
                        "stableTsEnabled": True,
                        "stableTsModel": "base",
                        "provider": "stable_ts",
                        "whisperxEnabled": False,
                    },
                },
                reason="regression test for stable ts fallback",
            ),
            object(),
        )
    )

    assert response["ok"] is True
    assert response["timingProvenance"] == "realigned"
    assert response["wordCount"] == 2
    assert response["stages"][1]["status"] == "unavailable"
    assert response["stages"][2]["name"] == "Forced alignment"
    assert response["stages"][2]["status"] == "passed"


def test_strict_snapshot_fails_before_provider_call_when_aligner_unavailable(monkeypatch, tmp_path):
    calls = []
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"RIFF....WAVEfmt " + b"\0" * 128)

    monkeypatch.setattr(transcriber, "_provider_key_available", lambda provider: True)
    monkeypatch.setattr(transcriber, "_call_provider", lambda *args, **kwargs: calls.append(args) or {})
    monkeypatch.setattr(
        timing,
        "alignment_provider_status",
        lambda: {
            "realForcedAlignmentAvailable": False,
            "forcedAlignmentUnavailableReasons": ["forced_alignment_disabled"],
        },
    )

    with pytest.raises(transcriber.TranscriptionProviderError) as exc:
        transcriber.transcribe_audio(
            str(audio),
            "english",
            transcription_config_snapshot={
                "configuration_id": "cfg",
                "provider": "gemini",
                "model": "gemini-2.5-flash",
                "version": 7,
                "provider_options": {},
                "timestamp_strategy": "local_forced_alignment",
                "strict_provider": True,
            },
        )

    assert exc.value.category == "forced_alignment_unavailable"
    assert calls == []


def test_transcription_database_status_reports_draft_only(monkeypatch):
    monkeypatch.setattr(transcription_control, "_database_url", lambda: "postgresql://example")
    monkeypatch.setattr(transcription_control, "psycopg", object())
    monkeypatch.setattr(transcription_control, "_active_config_row", lambda *args, **kwargs: None)
    monkeypatch.setattr(transcription_control, "_configuration_counts", lambda *_args, **_kwargs: {"total": 1, "active": 0, "draft": 1})
    monkeypatch.setattr(transcription_control, "_env_snapshot", lambda: None)
    transcription_control.invalidate_transcription_config_cache()

    assert transcription_control.active_transcription_config() is None
    status = transcription_control.transcription_database_status()
    assert status["category"] == "database_draft_only"
    assert status["fallback"] is False


def test_transcription_database_status_sanitizes_auth_failure(monkeypatch):
    monkeypatch.setattr(transcription_control, "_database_url", lambda: "postgresql://example")
    monkeypatch.setattr(transcription_control, "psycopg", object())

    def raise_auth(*_args, **_kwargs):
        raise RuntimeError("password authentication failed for user secret-user")

    monkeypatch.setattr(transcription_control, "_active_config_row", raise_auth)
    monkeypatch.setattr(transcription_control, "_env_snapshot", lambda: None)
    transcription_control.invalidate_transcription_config_cache()

    assert transcription_control.active_transcription_config() is None
    status = transcription_control.transcription_database_status()
    assert status["category"] == "database_authentication_failed"
    assert status["fallback"] is False
