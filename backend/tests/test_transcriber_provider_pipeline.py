import json
import wave

import pytest
import requests
from google.genai import errors as genai_errors

import ai_pipeline.transcriber as transcriber


def _write_wav(path):
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\0\0" * 16000)
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
                        "segments": [
                            {
                                "start": 0,
                                "end": 0.5,
                                "text": "hello",
                                "words": [{"word": "hello", "start": 0, "end": 0.5}],
                            }
                        ],
                    }
                )
            )

        return FakeGeminiClient(handler)

    monkeypatch.setattr(transcriber, "_gemini_client", fake_client)
    result = transcriber._call_gemini(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "gemini"
    assert seen["keys"] == ["preferred-gemini-key"]
    assert seen["kwargs"]["model"] == transcriber.GEMINI_MODEL
    assert "response_format" in seen["kwargs"]
    assert "legacy-google-key" not in caplog.text
    assert "preferred-gemini-key" not in caplog.text
    assert "GOOGLE_API_KEY is ignored" in caplog.text


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
        (401, "authentication"),
        (403, "permission_or_blocked_key"),
        (429, "quota_or_rate_limit"),
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

    assert classified.category == "permission_or_blocked_key"
    assert classified.status == 403


def test_gemini_response_status_code_is_classified():
    class Response:
        status_code = 403

    class ProviderError(RuntimeError):
        response = Response()

    classified = transcriber._classify_gemini_error(ProviderError("forbidden"))

    assert classified.category == "permission_or_blocked_key"
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
    assert "gemini(authentication: invalid Gemini API key)" in message
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
