import array
import wave

from ai_pipeline.audio import extract_audio


def test_phase_inverted_stereo_is_not_cancelled(tmp_path):
    source = tmp_path / "phase-inverted.wav"
    output = tmp_path / "normalized.wav"
    samples = array.array("h")
    for index in range(1_600):
        left = 12_000 if index % 20 < 10 else -12_000
        samples.extend((left, -left))
    with wave.open(str(source), "wb") as writer:
        writer.setnchannels(2)
        writer.setsampwidth(2)
        writer.setframerate(16_000)
        writer.writeframes(samples.tobytes())

    extract_audio(str(source), str(output))

    with wave.open(str(output), "rb") as reader:
        assert reader.getnchannels() == 1
        assert reader.getframerate() == 16_000
        assert reader.getsampwidth() == 2
        normalized = array.array("h", reader.readframes(reader.getnframes()))
    assert max(abs(sample) for sample in normalized) > 10_000

