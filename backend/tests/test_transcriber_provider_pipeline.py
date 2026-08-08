import json
import wave

import pytest
import requests
from google.genai import errors as genai_errors

import ai_pipeline.transcriber as transcriber
from server.transcription_catalog import catalog_entry


def _write_wav(path):
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\0\0" * 16000)
    return str(path)


def _write_wav_seconds(path, seconds: float):
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\0\0" * int(16000 * seconds))
    return str(path)


def _write_mp3_like(path):
    path.write_bytes(b"ID3\x04\x00\x00\x00\x00\x00\x21" + b"\0" * 64)
    return str(path)


def _write_mp4_like(path):
    path.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\0" * 64)
    return str(path)


def _result(provider="gemini", text="hello world"):
    return {
        "text": text,
        "language": "en",
        "duration": 1.0,
        "segments": [],
        "words": [
            {"word": "hello", "start": 0.0, "end": 0.4, "provider": provider},
            {"word": "world", "start": 0.5, "end": 0.9, "provider": provider},
        ],
        "provider": provider,
        "model": "test-model",
    }


def _clear_provider_env(monkeypatch):
    for key in (
        "STT_PROVIDER",
        "STT_PROVIDER_ORDER",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "SARVAM_API_KEY",
        "GROQ_API_KEY",
        "OPENAI_API_KEY",
    ):
        monkeypatch.delenv(key, raising=False)


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text
        self.headers = {"x-request-id": (payload or {}).get("request_id", "req-test")}

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeInteraction:
    def __init__(self, output_text):
        self.output_text = output_text


class FakeInteractions:
    def __init__(self, handler):
        self.handler = handler

    def create(self, **kwargs):
        return self.handler(**kwargs)


class FakeFiles:
    def __init__(self):
        self.uploads = []

    def upload(self, **kwargs):
        self.uploads.append(kwargs)
        return type("Uploaded", (), {"uri": "file://uploaded", "mime_type": "audio/wav"})()


class FakeGeminiClient:
    def __init__(self, handler):
        self.interactions = FakeInteractions(handler)
        self.files = FakeFiles()


class FakeOpenAITranscriptions:
    def __init__(self, handler):
        self.handler = handler

    def create(self, **kwargs):
        return self.handler(**kwargs)


class FakeOpenAIAudio:
    def __init__(self, handler):
        self.transcriptions = FakeOpenAITranscriptions(handler)


class FakeOpenAIClient:
    def __init__(self, handler):
        self.audio = FakeOpenAIAudio(handler)


def test_gemini_succeeds_and_no_fallback_runs(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    called = []

    def fake_call(provider, audio_path, mode):
        called.append(provider)
        return _result(provider)

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    result = transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "gemini"
    assert "fallback" not in result
    assert called == ["gemini"]


def test_gemini_uses_explicit_sdk_key_and_prefers_gemini_key(monkeypatch, tmp_path, caplog):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "preferred-gemini-key")
    monkeypatch.setenv("GOOGLE_API_KEY", "legacy-google-key")
    seen = {"keys": []}

    def fake_client(api_key):
        seen["keys"].append(api_key)

        def handler(**kwargs):
            seen["kwargs"] = kwargs
            return FakeInteraction(
                json.dumps(
                    {
                        "language": "en",
                        "text": "hello",
                    }
                )
            )

        return FakeGeminiClient(handler)

    monkeypatch.setattr(transcriber, "_gemini_client", fake_client)
    result = transcriber._call_gemini(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "gemini"
    assert result["text"] == "hello"
    assert result["segments"] == []
    assert result["words"] == []
    assert result["timestamp_strategy"] == "local_forced_alignment"
    assert seen["keys"] == ["preferred-gemini-key"]
    assert seen["kwargs"]["model"] == transcriber.GEMINI_MODEL
    assert seen["kwargs"]["timeout"] == transcriber.STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS
    assert "response_format" in seen["kwargs"]
    assert "legacy-google-key" not in caplog.text
    assert "preferred-gemini-key" not in caplog.text
    assert "GOOGLE_API_KEY is ignored" in caplog.text


def test_audio_mime_type_is_sniffed_from_bytes_not_extension(tmp_path):
    wav_path = tmp_path / "audio.bin"
    mp3_path = tmp_path / "audio.unknown"

    _write_wav(wav_path)
    _write_mp3_like(mp3_path)

    assert transcriber._audio_mime_type(str(wav_path)) == "audio/wav"
    assert transcriber._audio_mime_type(str(mp3_path)) == "audio/mpeg"


def test_gemini_audio_input_uses_supported_mime_and_never_octet_stream(tmp_path):
    audio_path = _write_mp3_like(tmp_path / "chunk.mp3")
    payload = transcriber._gemini_audio_input(FakeGeminiClient(lambda **kwargs: None), audio_path)

    assert payload["type"] == "audio"
    assert payload["mime_type"] == "audio/mpeg"
    assert payload["mime_type"] != "application/octet-stream"


def test_gemini_audio_input_transcodes_mp4_container_before_upload(monkeypatch, tmp_path):
    source_path = _write_mp4_like(tmp_path / "bad.mp4")
    converted_path = _write_wav(tmp_path / "converted.wav")

    monkeypatch.setattr(transcriber, "_transcode_gemini_audio_to_wav", lambda path: converted_path)

    payload = transcriber._gemini_audio_input(FakeGeminiClient(lambda **kwargs: None), source_path)

    assert payload["mime_type"] == "audio/wav"


def test_sarvam_upload_mime_matches_mp3_bytes(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    seen = {}

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        seen["files"] = files
        return FakeResponse(
            payload={
                "transcript": "hello",
                "language_code": "en-IN",
                "timestamps": {
                    "words": ["hello"],
                    "start_time_seconds": [0.0],
                    "end_time_seconds": [0.4],
                },
            }
        )

    monkeypatch.setattr(transcriber.requests, "post", fake_post)
    result = transcriber._call_sarvam(_write_mp3_like(tmp_path / "chunk.mp3"), "english")

    assert result["provider"] == "sarvam"
    assert seen["files"]["file"][2] == "audio/mpeg"


def test_sarvam_request_uses_rest_header_auth_and_timestamp_field(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    seen = {}

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        seen["url"] = url
        seen["headers"] = dict(headers or {})
        seen["data"] = dict(data or {})
        seen["files"] = files
        return FakeResponse(
            payload={
                "transcript": "hello",
                "language_code": "en-IN",
                "timestamps": {
                    "words": ["hello"],
                    "start_time_seconds": [0.0],
                    "end_time_seconds": [0.4],
                },
            },
        )

    monkeypatch.setattr(transcriber.requests, "post", fake_post)
    result = transcriber._call_sarvam(_write_wav(tmp_path / "chunk.wav"), "english")

    assert seen["url"] == "https://api.sarvam.ai/speech-to-text"
    assert "sarvam-secret" not in seen["url"]
    assert seen["headers"] == {"api-subscription-key": "sarvam-secret"}
    assert seen["data"]["model"] == "saaras:v3"
    assert seen["data"]["mode"] == "transcribe"
    assert seen["data"]["language_code"] == "en-IN"
    assert seen["data"]["with_timestamps"] == "true"
    assert result["sarvamRetryAttempts"][0]["withTimestampsField"] == "true"
    assert result["sarvamTimingDiagnostics"]["request"]["authHeader"] == "api-subscription-key"


def test_sarvam_post_refuses_native_path_without_timestamp_request(tmp_path):
    with pytest.raises(transcriber.TranscriptionProviderError) as exc:
        transcriber._sarvam_post_audio(
            _write_wav(tmp_path / "chunk.wav"),
            api_key="secret",
            model="saaras:v3",
            mode="transcribe",
            language_code="en-IN",
            timeout_seconds=5,
            with_timestamps=False,
        )

    assert exc.value.category == "sarvam_timestamps_not_requested"


def test_sarvam_parser_accepts_only_single_lexical_native_words():
    result = transcriber._normalize_sarvam_words(
        {
            "transcript": "hello how are you",
            "timestamps": {
                "words": ["hello", "how", "are", "you"],
                "start_time_seconds": [0.0, 0.2, 0.4, 0.6],
                "end_time_seconds": [0.1, 0.3, 0.5, 0.8],
            },
        },
        audio_duration=1.0,
    )

    assert result.granularity == "native_word"
    assert result.native_word_count == 4
    assert result.phrase_entry_count == 0
    assert {word["timing_source"] for word in result.words} == {"provider_native"}


def test_sarvam_parser_does_not_reject_native_words_due_to_transcript_punctuation():
    result = transcriber._normalize_sarvam_words(
        {
            "transcript": "Hello, world! Okay.",
            "timestamps": {
                "words": ["Hello", "world"],
                "start_time_seconds": [0.0, 0.5],
                "end_time_seconds": [0.4, 0.9],
            },
        },
        audio_duration=1.0,
    )

    assert result.granularity == "native_word"
    assert result.native_word_count == 2


def test_sarvam_parser_classifies_null_empty_and_mismatched_timestamp_arrays():
    with pytest.raises(transcriber.TranscriptionProviderError) as exc:
        transcriber._normalize_sarvam_words({"transcript": "hello", "timestamps": None})
    assert exc.value.category == "sarvam_timestamps_null"

    empty = transcriber._normalize_sarvam_words(
        {
            "transcript": "hello",
            "timestamps": {
                "words": [],
                "start_time_seconds": [],
                "end_time_seconds": [],
            },
        }
    )
    assert empty.granularity == "missing"
    assert "timestamp arrays empty" in empty.warnings

    with pytest.raises(transcriber.TranscriptionProviderError) as exc:
        transcriber._normalize_sarvam_words(
            {
                "transcript": "hello",
                "timestamps": {
                    "words": ["hello"],
                    "start_time_seconds": [0.0, 0.1],
                    "end_time_seconds": [0.4],
                },
            }
        )
    assert exc.value.category == "sarvam_timestamp_array_length_mismatch"


def test_sarvam_parser_classifies_multi_word_entries_as_phrase():
    result = transcriber._normalize_sarvam_words(
        {
            "transcript": "hello how are you",
            "timestamps": {
                "words": ["hello how", "are you"],
                "start_time_seconds": [0.0, 0.5],
                "end_time_seconds": [0.4, 0.9],
            },
        },
        audio_duration=1.0,
    )

    assert result.granularity == "phrase"
    assert result.native_word_count == 0
    assert result.phrase_entry_count == 2
    assert {word["timing_source"] for word in result.words} == {"provider_phrase"}


def test_sarvam_parser_rejects_non_monotonic_and_out_of_bounds_timestamps():
    with pytest.raises(transcriber.TranscriptionProviderError) as exc:
        transcriber._normalize_sarvam_words(
            {
                "transcript": "hello world",
                "timestamps": {
                    "words": ["hello", "world"],
                    "start_time_seconds": [0.5, 0.2],
                    "end_time_seconds": [0.7, 0.9],
                },
            },
            audio_duration=1.0,
        )
    assert exc.value.category == "sarvam_timestamp_values_invalid"

    with pytest.raises(transcriber.TranscriptionProviderError) as exc:
        transcriber._normalize_sarvam_words(
            {
                "transcript": "hello",
                "timestamps": {
                    "words": ["hello"],
                    "start_time_seconds": [0.0],
                    "end_time_seconds": [4.0],
                },
            },
            audio_duration=1.0,
        )
    assert exc.value.category == "sarvam_timestamp_values_invalid"


def test_sarvam_same_mode_retry_recovers_native_word_timing(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    calls = []

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        calls.append(dict(data or {}))
        if len(calls) == 1:
            return FakeResponse(
                payload={
                    "transcript": "hello world",
                    "request_id": "phrase-1",
                    "timestamps": {
                        "words": ["hello world"],
                        "start_time_seconds": [0.0],
                        "end_time_seconds": [0.8],
                    },
                }
            )
        return FakeResponse(
            payload={
                "transcript": "hello world",
                "request_id": "native-2",
                "timestamps": {
                    "words": ["hello", "world"],
                    "start_time_seconds": [0.0, 0.5],
                    "end_time_seconds": [0.4, 0.8],
                },
            }
        )

    monkeypatch.setattr(transcriber.requests, "post", fake_post)
    result = transcriber._call_sarvam(_write_wav(tmp_path / "chunk.wav"), "english")

    assert [call["mode"] for call in calls] == ["transcribe", "transcribe"]
    assert [call["with_timestamps"] for call in calls] == ["true", "true"]
    assert result["timing_mode"] == "transcribe"
    assert result["nativeWordCount"] == 2
    assert [word["timing_source"] for word in result["words"]] == ["provider_native", "provider_native"]
    assert result["provider_request_ids"] == ["phrase-1", "native-2"]


def test_sarvam_smaller_chunk_retry_merges_chunk_local_offsets(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    source = _write_wav_seconds(tmp_path / "source.wav", 16.0)
    small_a = _write_wav_seconds(tmp_path / "small-a.wav", 8.0)
    small_b = _write_wav_seconds(tmp_path / "small-b.wav", 8.0)
    calls = []

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        calls.append(dict(data or {}))
        if len(calls) <= 2:
            return FakeResponse(
                payload={
                    "transcript": "hello world",
                    "request_id": f"phrase-{len(calls)}",
                    "timestamps": {
                        "words": ["hello world"],
                        "start_time_seconds": [0.0],
                        "end_time_seconds": [0.8],
                    },
                }
            )
        word = "hello" if len(calls) == 3 else "world"
        return FakeResponse(
            payload={
                "transcript": word,
                "request_id": f"native-{len(calls)}",
                "timestamps": {
                    "words": [word],
                    "start_time_seconds": [0.1],
                    "end_time_seconds": [0.5],
                },
            }
        )

    monkeypatch.setattr(transcriber.requests, "post", fake_post)
    monkeypatch.setattr(transcriber, "_small_sarvam_audio_chunks", lambda _path: [(small_a, 0.0, 8.0), (small_b, 8.0, 16.0)])

    result = transcriber._call_sarvam(source, "english")

    assert [call["mode"] for call in calls] == [
        "transcribe",
        "transcribe",
        "transcribe",
        "transcribe",
    ]
    assert [call["with_timestamps"] for call in calls] == ["true", "true", "true", "true"]
    assert result["timing_mode"] == "transcribe_small_chunks"
    assert [word["start"] for word in result["words"]] == [0.1, 8.1]
    assert result["nativeWordCount"] == 2


def test_sarvam_small_retry_splits_phrase_chunks_even_under_rest_max(tmp_path):
    source = _write_wav_seconds(tmp_path / "source.wav", 8.8)

    chunks = transcriber._small_sarvam_audio_chunks(source)

    try:
        assert len(chunks) == 2
        assert chunks[0][1] == 0.0
        assert 4.0 < chunks[0][2] < 4.6
        assert 4.2 < chunks[1][1] < 4.5
        assert chunks[1][2] == pytest.approx(8.8, abs=0.02)
    finally:
        for path, _start, _end in chunks:
            try:
                import os

                os.remove(path)
            except OSError:
                pass


def test_sarvam_smaller_chunk_retry_dedupes_padding_overlap(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    source = _write_wav_seconds(tmp_path / "source.wav", 16.0)
    small_a = _write_wav_seconds(tmp_path / "small-a.wav", 8.1)
    small_b = _write_wav_seconds(tmp_path / "small-b.wav", 8.1)
    calls = []

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        calls.append(dict(data or {}))
        if len(calls) <= 2:
            return FakeResponse(
                payload={
                    "transcript": "hello world",
                    "request_id": f"phrase-{len(calls)}",
                    "timestamps": {
                        "words": ["hello world"],
                        "start_time_seconds": [0.0],
                        "end_time_seconds": [0.8],
                    },
                }
            )
        if len(calls) == 3:
            return FakeResponse(
                payload={
                    "transcript": "hello again",
                    "request_id": "native-a",
                    "timestamps": {
                        "words": ["hello", "again"],
                        "start_time_seconds": [0.1, 7.9],
                        "end_time_seconds": [0.5, 8.05],
                    },
                }
            )
        return FakeResponse(
            payload={
                "transcript": "again world",
                "request_id": "native-b",
                "timestamps": {
                    "words": ["again", "world"],
                    "start_time_seconds": [0.02, 0.4],
                    "end_time_seconds": [0.15, 0.8],
                },
            }
        )

    monkeypatch.setattr(transcriber.requests, "post", fake_post)
    monkeypatch.setattr(transcriber, "_small_sarvam_audio_chunks", lambda _path: [(small_a, 0.0, 8.08), (small_b, 7.95, 16.0)])

    result = transcriber._call_sarvam(source, "english")

    assert [word["word"] for word in result["words"]] == ["hello", "again", "world"]
    starts = [word["start"] for word in result["words"]]
    assert starts == sorted(starts)


def test_sarvam_phrase_timing_returns_transcript_for_forced_alignment(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    source = _write_wav_seconds(tmp_path / "source.wav", 8.0)
    small_a = _write_wav_seconds(tmp_path / "small-a.wav", 4.0)
    small_b = _write_wav_seconds(tmp_path / "small-b.wav", 4.0)
    calls = []

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        calls.append(dict(data or {}))
        return FakeResponse(
            payload={
                "transcript": "hello world",
                "request_id": f"phrase-{len(calls)}",
                "timestamps": {
                    "words": ["hello world"],
                    "start_time_seconds": [0.0],
                    "end_time_seconds": [0.8],
                },
            }
        )

    monkeypatch.setattr(transcriber.requests, "post", fake_post)
    monkeypatch.setattr(transcriber, "_small_sarvam_audio_chunks", lambda _path: [(small_a, 0.0, 4.0), (small_b, 4.0, 8.0)])

    result = transcriber._call_sarvam(source, "english")

    assert result["text"] == "hello world"
    assert result["nativeWordsAvailable"] is False
    assert result["nativeTimingFailureCategory"] == "sarvam_phrase_timestamps"
    assert result["timing_granularity"] == "phrase"
    assert result["timestamp_capability"] == "provider_phrase"
    assert result["words"][0]["preservePhraseTiming"] is True
    assert [call["with_timestamps"] for call in calls] == ["true", "true", "true"]


def test_sarvam_empty_timestamp_arrays_return_transcript_for_forced_alignment(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    source = _write_wav_seconds(tmp_path / "source.wav", 8.0)
    small = _write_wav_seconds(tmp_path / "small.wav", 4.0)

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        return FakeResponse(
            payload={
                "transcript": "hello world",
                "request_id": "empty-arrays",
                "timestamps": {
                    "words": [],
                    "start_time_seconds": [],
                    "end_time_seconds": [],
                },
            }
        )

    monkeypatch.setattr(transcriber.requests, "post", fake_post)
    monkeypatch.setattr(transcriber, "_small_sarvam_audio_chunks", lambda _path: [(small, 0.0, 4.0)])

    result = transcriber._call_sarvam(source, "english")

    assert result["text"] == "hello world"
    assert result["words"] == []
    assert result["nativeWordsAvailable"] is False
    assert result["nativeTimingFailureCategory"] == "sarvam_timestamps_empty"
    assert result["timing_granularity"] == "missing"
    assert result["timestamp_capability"] == "provider_phrase"


def test_sarvam_phrase_timing_with_native_then_forced_does_not_throw_in_transcribe_audio(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    source = _write_wav_seconds(tmp_path / "source.wav", 8.0)
    small = _write_wav_seconds(tmp_path / "small.wav", 4.0)

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        return FakeResponse(
            payload={
                "transcript": "hello world",
                "request_id": "phrase-only",
                "timestamps": {
                    "words": ["hello world"],
                    "start_time_seconds": [0.0],
                    "end_time_seconds": [0.8],
                },
            }
        )

    monkeypatch.setattr(transcriber.requests, "post", fake_post)
    monkeypatch.setattr(transcriber, "_small_sarvam_audio_chunks", lambda _path: [(small, 0.0, 4.0)])

    result = transcriber.transcribe_audio(
        source,
        "english",
        transcription_config_snapshot={
            "configuration_id": "cfg",
            "provider": "sarvam",
            "model": "saaras:v3",
            "version": 1,
            "provider_options": {},
            "timestamp_strategy": "provider_word",
            "strict_provider": True,
            "resolved_pipeline_options": {"timingSourcePolicy": "native_then_forced"},
        },
    )

    assert result["text"] == "hello world"
    assert result["nativeWordsAvailable"] is False
    assert result["nativeTimingFailureCategory"] == "sarvam_phrase_timestamps"


def test_sarvam_catalog_describes_rest_timestamps_not_batch_native_words():
    entry = catalog_entry("sarvam", "saaras:v3")

    assert entry is not None
    assert entry.timestamp_strategy == "provider_word"
    assert "with_timestamps=true" in entry.timestamp_capability
    assert "Batch is chunk timestamps only" in entry.timestamp_capability


@pytest.mark.parametrize(
    ("source_language", "output_language", "expected_mode", "expected_language_code"),
    [
        ("telugu", "original", "transcribe", "te-IN"),
        ("telgish", "original", "translit", "te-IN"),
        ("hinglish", "original", "translit", "hi-IN"),
        ("auto_mixed_indian", "original", "codemix", "unknown"),
        ("auto", "original", "codemix", "unknown"),
        ("english", "original", "transcribe", "en-IN"),
        ("telugu", "english", "translate", "te-IN"),
    ],
)
def test_sarvam_request_options_follow_job_language_not_admin_fixture(
    source_language,
    output_language,
    expected_mode,
    expected_language_code,
):
    resolved = transcriber.resolve_sarvam_request_options(source_language, output_language)

    assert resolved == {"mode": expected_mode, "language_code": expected_language_code}


def test_sarvam_admin_provider_options_do_not_override_telgish_job(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    seen = {}

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        seen["url"] = url
        seen["data"] = dict(data or {})
        return FakeResponse(
            payload={
                "transcript": "idi rendu nimishalu",
                "language_code": "te-IN",
                "timestamps": {
                    "words": ["idi", "rendu", "nimishalu"],
                    "start_time_seconds": [0.0, 0.3, 0.8],
                    "end_time_seconds": [0.2, 0.7, 1.2],
                },
                "request_id": "sarvam-req-1",
            }
        )

    monkeypatch.setattr(transcriber.requests, "post", fake_post)
    result = transcriber._call_sarvam(
        _write_mp3_like(tmp_path / "chunk.mp3"),
        "telgish",
        {
            "configuration_id": "cfg",
            "provider": "sarvam",
            "model": "saaras:v3",
            "version": 11,
            "provider_options": {
                "mode": "transcribe",
                "languageStrategy": "language_mode_mapping",
            },
            "timestamp_strategy": "provider_word",
            "strict_provider": True,
            "source_language": "telgish",
            "output_language": "original",
        },
    )

    assert seen["url"] == transcriber.SARVAM_URL
    assert seen["data"]["model"] == "saaras:v3"
    assert seen["data"]["mode"] == "translit"
    assert seen["data"]["language_code"] == "te-IN"
    assert seen["data"]["with_timestamps"] == "true"
    assert result["providerMode"] == "translit"
    assert result["providerLanguageCode"] == "te-IN"
    assert result["providerRawText"] == "idi rendu nimishalu"


def test_openai_whisper_uses_timeout_no_retries_model_and_actual_mime(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "openai-secret")
    seen = {"clients": []}

    def fake_openai(**kwargs):
        seen["clients"].append(kwargs)

        def handler(**create_kwargs):
            seen["create"] = create_kwargs
            return {
                "text": "hello",
                "language": "en",
                "duration": 1.0,
                "segments": [{"start": 0, "end": 0.5, "text": "hello"}],
                "words": [{"word": "hello", "start": 0.0, "end": 0.5}],
            }

        return FakeOpenAIClient(handler)

    monkeypatch.setattr(transcriber, "OpenAI", fake_openai)
    result = transcriber._call_openai_whisper(_write_mp3_like(tmp_path / "chunk.mp3"), "english")

    assert result["provider"] == "openai_whisper"
    assert result["model"] == transcriber.OPENAI_TRANSCRIPTION_MODEL
    assert seen["clients"] == [
        {
            "api_key": "openai-secret",
            "timeout": transcriber.STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS,
            "max_retries": 0,
        }
    ]
    assert seen["create"]["model"] == "whisper-1"
    assert seen["create"]["response_format"] == "verbose_json"
    assert seen["create"]["timestamp_granularities"] == ["word", "segment"]
    assert seen["create"]["timeout"] == transcriber.STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS
    assert seen["create"]["temperature"] == 0
    assert seen["create"]["file"][2] == "audio/mpeg"


def test_openai_whisper_transcodes_mp4_container_before_upload(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "openai-secret")
    source_path = _write_mp4_like(tmp_path / "bad.mp4")
    converted_path = _write_wav(tmp_path / "converted.wav")
    seen = {}

    monkeypatch.setattr(transcriber, "_transcode_gemini_audio_to_wav", lambda path: converted_path)

    def fake_openai(**kwargs):
        def handler(**create_kwargs):
            seen["create"] = create_kwargs
            return {
                "text": "hello",
                "language": "en",
                "duration": 1.0,
                "segments": [{"start": 0, "end": 0.5, "text": "hello"}],
                "words": [{"word": "hello", "start": 0.0, "end": 0.5}],
            }

        return FakeOpenAIClient(handler)

    monkeypatch.setattr(transcriber, "OpenAI", fake_openai)
    result = transcriber._call_openai_whisper(source_path, "english")

    assert result["provider"] == "openai_whisper"
    assert seen["create"]["file"][0] == "converted.wav"
    assert seen["create"]["file"][2] == "audio/wav"


@pytest.mark.parametrize("key", ["AQ.testAuthorizationKey1234567890", "AIzaSyA-test-key-format-only"])
def test_gemini_key_formats_are_accepted_without_prefix_or_length_validation(monkeypatch, key):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", f"  {key}  ")

    assert transcriber._gemini_api_key() == key


@pytest.mark.parametrize(
    "value",
    ["<real sarvam key or remove it>", "<real groq key or remove it>", "your_api_key", "...", "placeholder-secret"],
)
def test_placeholder_values_are_treated_as_missing(value):
    assert transcriber.is_real_secret(value) is False


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, "authentication_failed"),
        (403, "permission_denied"),
        (429, "rate_limited"),
    ],
)
def test_gemini_http_status_classification(status, expected):
    exc = genai_errors.ClientError(status, {"error": {"status": "TEST_STATUS", "message": "safe message"}})
    classified = transcriber._classify_gemini_error(exc)

    assert classified.category == expected
    assert classified.status == status
    assert "safe message" in str(classified)


def test_gemini_raw_403_text_is_classified_as_permission_error():
    exc = RuntimeError('HTTP Request: POST https://generativelanguage.googleapis.com/v1beta/interactions "HTTP/1.1 403 Forbidden"')

    classified = transcriber._classify_gemini_error(exc)

    assert classified.category == "permission_denied"
    assert classified.status == 403


def test_gemini_response_status_code_is_classified():
    class Response:
        status_code = 403

    class ProviderError(RuntimeError):
        response = Response()

    classified = transcriber._classify_gemini_error(ProviderError("forbidden"))

    assert classified.category == "permission_denied"
    assert classified.status == 403


@pytest.mark.parametrize("status", [401, 403, 429])
def test_gemini_http_failures_fall_back_to_sarvam(monkeypatch, tmp_path, status):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    calls = []

    def fake_call(provider, audio_path, mode):
        calls.append(provider)
        if provider == "gemini":
            category = "rate_limit" if status == 429 else "authentication"
            raise transcriber.TranscriptionProviderError(provider, category, status=status)
        return _result(provider)

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    result = transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    assert calls == ["gemini", "sarvam"]
    assert result["provider"] == "sarvam"
    assert result["fallback"] is True
    assert result["fallback_from"] == ["gemini"]


def test_gemini_timeout_falls_back_to_sarvam(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")

    def fake_call(provider, audio_path, mode):
        if provider == "gemini":
            raise requests.Timeout("slow")
        return _result(provider)

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    result = transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "sarvam"
    assert result["fallback_from"] == ["gemini"]


def test_gemini_invalid_json_falls_back_to_sarvam(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")

    def fake_call(provider, audio_path, mode):
        if provider == "gemini":
            raise transcriber.TranscriptionProviderError(provider, "malformed_response")
        return _result(provider)

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    result = transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "sarvam"


def test_gemini_text_without_valid_words_falls_back_to_sarvam(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")

    def fake_call(provider, audio_path, mode):
        if provider == "gemini":
            return {"text": "hello world", "words": [], "provider": "gemini"}
        return _result(provider)

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    result = transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "sarvam"
    assert result["fallback_from"] == ["gemini"]


def test_gemini_and_sarvam_fail_then_groq_succeeds(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    monkeypatch.setenv("GROQ_API_KEY", "groq-secret")

    def fake_call(provider, audio_path, mode):
        if provider in {"gemini", "sarvam"}:
            raise transcriber.TranscriptionProviderError(provider, "provider_error")
        return _result(provider)

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    result = transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "groq_whisper"
    assert result["fallback_from"] == ["gemini", "sarvam"]


def test_gemini_sarvam_and_groq_fail_then_openai_succeeds(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    monkeypatch.setenv("GROQ_API_KEY", "groq-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-secret")

    def fake_call(provider, audio_path, mode):
        if provider != "openai_whisper":
            raise transcriber.TranscriptionProviderError(provider, "provider_error")
        return _result(provider)

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    result = transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "openai_whisper"
    assert result["fallback_from"] == ["gemini", "sarvam", "groq_whisper"]


def test_missing_provider_keys_are_skipped(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-secret")
    calls = []

    def fake_call(provider, audio_path, mode):
        calls.append(provider)
        return _result(provider)

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    result = transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    assert calls == ["openai_whisper"]
    assert result["provider"] == "openai_whisper"


def test_auto_ignores_placeholder_fallback_keys(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("SARVAM_API_KEY", "<real sarvam key or remove it>")
    monkeypatch.setenv("GROQ_API_KEY", "<real groq key or remove it>")
    monkeypatch.setenv("OPENAI_API_KEY", "<real openai key or remove it>")
    calls = []

    def fake_call(provider, audio_path, mode):
        calls.append(provider)
        return _result(provider)

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    result = transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    assert calls == ["gemini"]
    assert result["provider"] == "gemini"


def test_all_providers_fail_returns_sanitized_combined_error(monkeypatch, tmp_path, caplog):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "auto")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    monkeypatch.setenv("GROQ_API_KEY", "groq-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-secret")

    def fake_call(provider, audio_path, mode):
        raise transcriber.TranscriptionProviderError(provider, "authentication", "secret gemini-secret")

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)

    with pytest.raises(RuntimeError) as exc_info:
        transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    message = str(exc_info.value)
    assert "gemini(authentication_failed: invalid Gemini API key)" in message
    assert "sarvam(authentication)" in message
    assert "groq_whisper(authentication)" in message
    assert "openai_whisper(authentication)" in message
    assert "gemini-secret" not in message
    assert "gemini-secret" not in caplog.text


def test_explicit_provider_remains_single_provider(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("STT_PROVIDER", "sarvam")
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-secret")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    calls = []

    def fake_call(provider, audio_path, mode):
        calls.append(provider)
        return _result(provider)

    monkeypatch.setattr(transcriber, "_call_provider", fake_call)
    result = transcriber.transcribe_audio(_write_wav(tmp_path / "a.wav"), "english")

    assert calls == ["sarvam"]
    assert result["provider"] == "sarvam"
