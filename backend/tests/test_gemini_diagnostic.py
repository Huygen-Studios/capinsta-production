import json
import wave

import pytest

from scripts import test_gemini_connection as diagnostic


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


class FakeClient:
    def __init__(self, handler):
        self.interactions = FakeInteractions(handler)
        self.files = FakeFiles()


def _write_wav(path):
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\0\0" * 16000)
    return path


def test_text_probe_succeeds(capsys):
    client = FakeClient(lambda **kwargs: FakeInteraction("OK"))

    assert diagnostic._text_probe(client, "gemini-3.5-flash") is True
    output = json.loads(capsys.readouterr().out)
    assert output["ok"] is True
    assert output["check"] == "text"


def test_text_probe_failure_is_sanitized(capsys):
    def handler(**kwargs):
        raise RuntimeError("bad key AQ.testAuthorizationKey1234567890")

    assert diagnostic._text_probe(FakeClient(handler), "gemini-3.5-flash") is False
    assert "AQ.testAuthorizationKey1234567890" not in capsys.readouterr().out


def test_small_audio_probe_uses_inline_data(tmp_path):
    audio = tmp_path / "small.wav"
    _write_wav(audio)
    seen = {}

    def handler(**kwargs):
        seen.update(kwargs)
        return FakeInteraction(
            json.dumps(
                {
                    "language": "en",
                    "segments": [
                        {
                            "start": 0,
                            "end": 1,
                            "text": "hello",
                            "words": [{"word": "hello", "start": 0, "end": 1}],
                        }
                    ],
                }
            )
        )

    client = FakeClient(handler)
    assert diagnostic._audio_probe(client, "gemini-3.5-flash", audio) is True
    audio_part = seen["input"][1]
    assert "data" in audio_part
    assert "uri" not in audio_part
    assert client.files.uploads == []


def test_large_audio_probe_uses_files_api(tmp_path, monkeypatch):
    audio = tmp_path / "large.wav"
    _write_wav(audio)
    monkeypatch.setattr(diagnostic, "GEMINI_INLINE_AUDIO_LIMIT_BYTES", 16)
    seen = {}

    def handler(**kwargs):
        seen.update(kwargs)
        return FakeInteraction(
            json.dumps(
                {
                    "language": "en",
                    "segments": [
                        {
                            "start": 0,
                            "end": 1,
                            "text": "hello",
                            "words": [{"word": "hello", "start": 0, "end": 1}],
                        }
                    ],
                }
            )
        )

    client = FakeClient(handler)
    assert diagnostic._audio_probe(client, "gemini-3.5-flash", audio) is True
    audio_part = seen["input"][1]
    assert audio_part["uri"] == "file://uploaded"
    assert client.files.uploads
