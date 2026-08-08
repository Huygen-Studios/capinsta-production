import json
import pytest
from google.genai import errors as genai_errors
import ai_pipeline.transcriber as transcriber
from tests.test_transcriber_provider_pipeline import _clear_provider_env, _write_wav, FakeInteraction, FakeGeminiClient

def test_gemini_returns_raw_text(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")

    def fake_client(api_key):
        def handler(**kwargs):
            return FakeInteraction(
                json.dumps(
                    {
                        "language": "en",
                        "text": "hello world",
                    }
                )
            )
        return FakeGeminiClient(handler)

    monkeypatch.setattr(transcriber, "_gemini_client", fake_client)
    result = transcriber._call_gemini(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "gemini"
    assert result["text"] == "hello world"
    assert result["language"] == "en"
    assert result["segments"] == []
    assert result["words"] == []


def test_gemini_fails_on_missing_text(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")

    def fake_client(api_key):
        def handler(**kwargs):
            return FakeInteraction(
                json.dumps(
                    {
                        "language": "en",
                        # Missing text entirely
                    }
                )
            )
        return FakeGeminiClient(handler)

    monkeypatch.setattr(transcriber, "_gemini_client", fake_client)
    with pytest.raises(transcriber.TranscriptionProviderError) as exc_info:
        transcriber._call_gemini(_write_wav(tmp_path / "a.wav"), "english")
    
    assert exc_info.value.category == "empty_transcript"


class CandidatePart:
    def __init__(self, text):
        self.text = text

class CandidateContent:
    def __init__(self, parts):
        self.parts = parts

class Candidate:
    def __init__(self, content):
        self.content = content

class FakeInteractionWithCandidates:
    def __init__(self, candidates):
        self.output_text = None
        self.text = None
        self.candidates = candidates

def test_gemini_extracts_text_from_candidates_if_output_text_missing(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")

    def fake_client(api_key):
        def handler(**kwargs):
            return FakeInteractionWithCandidates([
                Candidate(
                    CandidateContent([
                        CandidatePart(
                            json.dumps(
                                {
                                    "language": "en",
                                    "text": "test",
                                }
                            )
                        )
                    ])
                )
            ])
        return FakeGeminiClient(handler)

    monkeypatch.setattr(transcriber, "_gemini_client", fake_client)
    result = transcriber._call_gemini(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "gemini"
    assert result["text"] == "test"
    assert result["segments"] == []
    assert result["words"] == []
