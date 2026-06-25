from dataclasses import dataclass
from typing import Any

import pytest

from ai_pipeline.renderer import chunk_words_into_captions
from ai_pipeline.transcriber import _normalize_sarvam_words
from ai_pipeline.transcript_normalizer import TranscriptValidationError, build_word_timed_transcript_from_chunks


@dataclass
class FakeChunk:
    index: int
    start_time: float
    end_time: float
    final_text: str
    asr_metadata: dict[str, Any]


def _sarvam_payload() -> dict[str, Any]:
    return {
        "transcript": "hello there after a pause",
        "language_probability": 0.99,
        "timestamps": {
            "chunks": ["hello there", "after a pause"],
            "start_time_seconds": [0.2, 2.4],
            "end_time_seconds": [1.0, 3.3],
        },
    }


def test_sarvam_chunks_are_preserved_as_phrase_timing_units():
    words = _normalize_sarvam_words(_sarvam_payload())

    assert [word["word"] for word in words] == ["hello there", "after a pause"]
    assert all(word["timingGranularity"] == "phrase" for word in words)
    assert all(word["timing_source"] == "provider_phrase" for word in words)
    assert words[1]["start"] - words[0]["end"] == 1.4


def test_phrase_units_are_not_evenly_interpolated_into_fake_words():
    words = _normalize_sarvam_words(_sarvam_payload())
    with pytest.raises(TranscriptValidationError):
        build_word_timed_transcript_from_chunks(
            [
                FakeChunk(
                    index=0,
                    start_time=0.0,
                    end_time=3.3,
                    final_text="hello there after a pause",
                    asr_metadata={
                        "provider": "sarvam",
                        "timing_granularity": "phrase",
                        "words": words,
                    },
                )
            ],
            "english",
        )


def test_caption_chunking_keeps_provider_phrases_and_their_pause_atomic():
    words = _normalize_sarvam_words(_sarvam_payload())
    captions = chunk_words_into_captions(words)

    assert [caption["text"] for caption in captions] == ["hello there", "after a pause"]
    assert captions[0]["end"] < captions[1]["start"]
    assert captions[1]["start"] == 2.4


def test_phrase_tokens_are_rejected_instead_of_distributed_across_speech_islands():
    payload = {
        "transcript": "one two three four five six",
        "timestamps": {
            "chunks": ["one two three four five six"],
            "start_time_seconds": [0.0],
            "end_time_seconds": [5.0],
        },
    }
    words = _normalize_sarvam_words(payload)
    with pytest.raises(TranscriptValidationError):
        build_word_timed_transcript_from_chunks(
            [
                FakeChunk(
                    index=0,
                    start_time=0.0,
                    end_time=5.0,
                    final_text=payload["transcript"],
                    asr_metadata={
                        "provider": "sarvam",
                        "timing_granularity": "phrase",
                        "words": words,
                    },
                )
            ],
            "english",
            speech_segments=[
                {"start": 0.0, "end": 1.8},
                {"start": 3.0, "end": 5.0},
            ],
        )
