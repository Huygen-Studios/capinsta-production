import wave

from server.pipeline_runner import _e2e_transcription_result


def test_deterministic_provider_is_local_e2e_only(tmp_path, monkeypatch):
    audio = tmp_path / "range.wav"
    with wave.open(str(audio), "wb") as output:
        output.setparams((1, 2, 8_000, 8_000, "NONE", "not compressed"))
        output.writeframes(b"\0\0" * 8_000)

    assert _e2e_transcription_result(str(audio), "en") is None
    monkeypatch.setenv("CAPINSTA_E2E_TRANSCRIPTION", "true")
    monkeypatch.setenv("ENABLE_LOCAL_DEVELOPMENT_ACCESS", "true")
    monkeypatch.setenv("NODE_ENV", "development")
    result = _e2e_transcription_result(str(audio), "en")
    assert result and result["status"] == "success"
    assert result["transcript"]["metadata"]["e2eDeterministicProvider"] is True
    monkeypatch.setenv("NODE_ENV", "production")
    assert _e2e_transcription_result(str(audio), "en") is None
