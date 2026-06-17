from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .aligner import TranscriptAligner
from .transcript_normalizer import build_word_timed_transcript_from_chunks


@dataclass
class FakeChunk:
    index: int
    start_time: float
    end_time: float
    asr_metadata: dict[str, Any]
    final_text: str


def _first_word_start(segments: list[dict[str, Any]]) -> float:
    return float(segments[0]["words"][0]["start"])


def run_checks() -> None:
    local_audit: list[dict[str, Any]] = []
    local_segments = build_word_timed_transcript_from_chunks(
        [
            FakeChunk(
                index=1,
                start_time=10.0,
                end_time=20.0,
                final_text="hello",
                asr_metadata={
                    "provider": "regression",
                    "words": [{"word": "hello", "start": 0.5, "end": 0.9, "score": 1.0}],
                },
            )
        ],
        "english",
        chunk_audit=local_audit,
    )
    assert round(_first_word_start(local_segments), 3) == 10.5
    assert local_audit[0]["timestampBasis"] == "chunk_local"

    absolute_audit: list[dict[str, Any]] = []
    absolute_segments = build_word_timed_transcript_from_chunks(
        [
            FakeChunk(
                index=1,
                start_time=10.0,
                end_time=20.0,
                final_text="hello",
                asr_metadata={
                    "provider": "regression",
                    "words": [{"word": "hello", "start": 10.5, "end": 10.9, "score": 1.0}],
                },
            )
        ],
        "english",
        chunk_audit=absolute_audit,
    )
    assert round(_first_word_start(absolute_segments), 3) == 10.5
    assert absolute_audit[0]["timestampBasis"] == "absolute"

    overlap_audit: list[dict[str, Any]] = []
    overlap_segments = build_word_timed_transcript_from_chunks(
        [
            FakeChunk(
                index=0,
                start_time=0.0,
                end_time=20.0,
                final_text="hello hello maam so my name is shravan from",
                asr_metadata={
                    "provider": "sarvam",
                    "words": [
                        {
                            "word": "hello hello maam so my name is shravan from",
                            "start": 0.0,
                            "end": 20.0,
                            "score": 1.0,
                        }
                    ],
                },
            ),
            FakeChunk(
                index=1,
                start_time=16.0,
                end_time=36.0,
                final_text="hello acp pradyumani haa i run a ai agency",
                asr_metadata={
                    "provider": "sarvam",
                    "words": [
                        {
                            "word": "hello acp pradyumani haa i run a ai agency",
                            "start": 0.0,
                            "end": 20.0,
                            "score": 1.0,
                        }
                    ],
                },
            ),
        ],
        "auto_mixed_indian",
        chunk_audit=overlap_audit,
    )
    assert round(float(overlap_segments[1]["words"][0]["start"]), 3) == 16.0

    optimized = TranscriptAligner(enable_silero_vad=False, enable_stable_ts=False).optimize_segments(
        "missing.wav",
        overlap_segments,
        "auto_mixed_indian",
    )
    assert float(optimized[1]["start"]) < 17.0
    assert float(optimized[1]["start"]) >= float(optimized[0]["end"])

    ya_audit: list[dict[str, Any]] = []
    ya_segments = build_word_timed_transcript_from_chunks(
        [
            FakeChunk(
                index=5,
                start_time=80.0,
                end_time=91.8,
                final_text="ya",
                asr_metadata={
                    "provider": "sarvam",
                    "words": [{"word": "Ya.", "start": 0.0, "end": 11.8, "score": 1.0}],
                },
            )
        ],
        "auto_mixed_indian",
        speech_segments=[{"start": 80.5, "end": 80.9}, {"start": 83.0, "end": 91.0}],
        chunk_audit=ya_audit,
    )
    assert round(float(ya_segments[0]["words"][0]["start"]), 3) == 80.5
    assert "single long word snapped" in " ".join(ya_audit[0]["warnings"])

    vad_phrase_audit: list[dict[str, Any]] = []
    vad_phrase_segments = build_word_timed_transcript_from_chunks(
        [
            FakeChunk(
                index=0,
                start_time=0.0,
                end_time=20.0,
                final_text="one two three four five six seven eight",
                asr_metadata={
                    "provider": "sarvam",
                    "words": [
                        {
                            "word": "one two three four five six seven eight",
                            "start": 0.0,
                            "end": 20.0,
                            "score": 1.0,
                        }
                    ],
                },
            )
        ],
        "auto_mixed_indian",
        speech_segments=[{"start": 0.0, "end": 4.0}, {"start": 8.0, "end": 12.0}],
        chunk_audit=vad_phrase_audit,
    )
    vad_words = vad_phrase_segments[0]["words"]
    assert all(not (4.0 < float(word["start"]) < 8.0) for word in vad_words)
    assert "estimated phrase retimed to VAD speech" in " ".join(vad_phrase_audit[0]["warnings"])


if __name__ == "__main__":
    run_checks()
    print("timing regression checks passed")
