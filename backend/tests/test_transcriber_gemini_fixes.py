import json
import pytest
from google.genai import errors as genai_errors
import ai_pipeline.transcriber as transcriber
from tests.test_transcriber_provider_pipeline import _clear_provider_env, _write_wav, FakeInteraction, FakeGeminiClient

def test_gemini_derives_words_when_missing(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")

    def fake_client(api_key):
        def handler(**kwargs):
            return FakeInteraction(
                json.dumps(
                    {
                        "language": "en",
                        "segments": [
                            {
                                "start": 0,
                                "end": 1.0,
                                "text": "hello world",
                                # Missing words array
                            }
                        ],
                    }
                )
            )
        return FakeGeminiClient(handler)

    monkeypatch.setattr(transcriber, "_gemini_client", fake_client)
    result = transcriber._call_gemini(_write_wav(tmp_path / "a.wav"), "english")

    assert result["provider"] == "gemini"
    assert len(result["segments"]) == 1
    assert len(result["words"]) == 2
    assert result["words"][0]["word"] == "hello"
    assert result["words"][0]["timing_source"] == "derived_from_segment"
    assert result["words"][1]["word"] == "world"
    assert result["words"][1]["timing_source"] == "derived_from_segment"


def test_gemini_fails_on_missing_segments(monkeypatch, tmp_path):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")

    def fake_client(api_key):
        def handler(**kwargs):
            return FakeInteraction(
                json.dumps(
                    {
                        "language": "en",
                        # Missing segments entirely
                    }
                )
            )
        return FakeGeminiClient(handler)

    monkeypatch.setattr(transcriber, "_gemini_client", fake_client)
    with pytest.raises(transcriber.TranscriptionProviderError) as exc_info:
        transcriber._call_gemini(_write_wav(tmp_path / "a.wav"), "english")
    
    assert exc_info.value.category == "response_error"
    assert "missing segments" in str(exc_info.value)


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
                                    "segments": [
                                        {
                                            "start": 0,
                                            "end": 0.5,
                                            "text": "test",
                                            "words": [{"word": "test", "start": 0, "end": 0.5}],
                                        }
                                    ],
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
    assert len(result["segments"]) == 1
    assert result["segments"][0]["text"] == "test"
