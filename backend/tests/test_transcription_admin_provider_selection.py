import pytest

import ai_pipeline.transcriber as transcriber


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

    assert exc.value.category == "timestamps_invalid"


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
