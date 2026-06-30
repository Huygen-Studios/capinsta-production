from dataclasses import dataclass
from typing import Any

import pytest

from ai_pipeline.renderer import chunk_words_into_captions
from ai_pipeline.transcriber import _normalize_sarvam_words
from ai_pipeline.transcript_normalizer import build_word_timed_transcript_from_chunks


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


def test_phrase_units_generate_review_marked_estimated_words():
    words = _normalize_sarvam_words(_sarvam_payload())
    segments = build_word_timed_transcript_from_chunks(
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
    generated_words = [word for segment in segments for word in segment["words"]]

    assert [word["word"] for word in generated_words] == ["hello there", "after a pause"]
    assert all(word["timingNeedsReview"] for word in generated_words)
    assert all(word["end"] > word["start"] for word in generated_words)


def test_caption_chunking_keeps_provider_phrases_and_their_pause_atomic():
    words = _normalize_sarvam_words(_sarvam_payload())
    captions = chunk_words_into_captions(words)

    assert [caption["text"] for caption in captions] == ["hello there", "after a pause"]
    assert captions[0]["end"] < captions[1]["start"]
    assert captions[1]["start"] == 2.4


def test_phrase_tokens_generate_valid_estimated_words_across_speech_islands():
    payload = {
        "transcript": "one two three four five six",
        "timestamps": {
            "chunks": ["one two three four five six"],
            "start_time_seconds": [0.0],
            "end_time_seconds": [5.0],
        },
    }
    words = _normalize_sarvam_words(payload)
    segments = build_word_timed_transcript_from_chunks(
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
    generated_words = [word for segment in segments for word in segment["words"]]

    assert [word["word"] for word in generated_words] == ["one two three four five six"]
    assert all(word["timingNeedsReview"] for word in generated_words)
    assert all(word["end"] > word["start"] for word in generated_words)


def test_native_sarvam_chunk_local_words_receive_global_offset_once():
    segments = build_word_timed_transcript_from_chunks(
        [
            FakeChunk(
                index=0,
                start_time=10.0,
                end_time=18.0,
                final_text="hello world",
                asr_metadata={
                    "provider": "sarvam",
                    "timestamp_basis": "chunk_local",
                    "words": [
                        {"word": "hello", "start": 0.2, "end": 0.5, "timing_source": "provider_native"},
                        {"word": "world", "start": 1.0, "end": 1.4, "timing_source": "provider_native"},
                    ],
                },
            ),
            FakeChunk(
                index=1,
                start_time=17.9,
                end_time=25.0,
                final_text="again",
                asr_metadata={
                    "provider": "sarvam",
                    "timestamp_basis": "chunk_local",
                    "words": [
                        {"word": "again", "start": 0.4, "end": 0.8, "timing_source": "provider_native"},
                    ],
                },
            ),
        ],
        "english",
    )

    words = [word for segment in segments for word in segment["words"]]

    assert [round(word["start"], 3) for word in words] == [10.2, 11.0, 18.3]
    assert [round(word["end"], 3) for word in words] == [10.5, 11.4, 18.7]
    assert [word["start"] for word in words] == sorted(word["start"] for word in words)
