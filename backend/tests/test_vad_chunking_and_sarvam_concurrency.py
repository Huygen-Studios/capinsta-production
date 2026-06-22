import asyncio
import threading
import time

from ai_pipeline.audio import Chunk, build_vad_chunk_ranges
import ai_pipeline.main as pipeline_main
from ai_pipeline.transcriber import transcribe_sarvam_chunks_bounded
from ai_pipeline.transcript_normalizer import build_word_timed_transcript_from_chunks
import ai_pipeline.transcriber as transcriber


def test_vad_ranges_cut_at_silence_and_preserve_global_offsets():
    ranges = build_vad_chunk_ranges(
        [
            {"start": 1.0, "end": 7.0},
            {"start": 7.7, "end": 14.0},
            {"start": 16.0, "end": 23.0},
            {"start": 24.0, "end": 31.0},
        ],
        35.0,
        target_seconds=12,
        max_seconds=18,
        padding_seconds=0.08,
    )
    assert ranges == [(0.92, 14.08), (15.92, 31.08)]
    assert all(end - start <= 18 for start, end in ranges)


def test_long_unbroken_speech_is_bounded():
    ranges = build_vad_chunk_ranges(
        [{"start": 0.0, "end": 61.0}],
        61.0,
        target_seconds=15,
        max_seconds=25,
        padding_seconds=0,
    )
    assert ranges == [(0.0, 25.0), (25.0, 50.0), (50.0, 61.0)]


def test_chunk_local_sarvam_words_are_remapped_to_video_time():
    chunk = Chunk(0, "unused.wav", 12.5, 17.5)
    chunk.final_text = "hello world"
    chunk.asr_metadata = {
        "provider": "sarvam",
        "words": [
            {
                "word": "hello",
                "start": 0.2,
                "end": 0.7,
                "timing_source": "provider_word",
            },
            {
                "word": "world",
                "start": 0.8,
                "end": 1.3,
                "timing_source": "provider_word",
            },
        ],
    }
    segments = build_word_timed_transcript_from_chunks([chunk], "telgish")
    words = [word for segment in segments for word in segment["words"]]
    assert words[0]["start"] == 12.7
    assert words[1]["end"] == 13.8


def test_sarvam_requests_are_bounded_and_results_remain_ordered(monkeypatch):
    monkeypatch.setenv("SARVAM_MAX_CONCURRENCY", "2")
    monkeypatch.setattr(transcriber, "_resolve_provider", lambda mode: "sarvam")
    lock = threading.Lock()
    active = 0
    maximum_active = 0

    def fake_transcribe(path, language_mode):
        nonlocal active, maximum_active
        with lock:
            active += 1
            maximum_active = max(maximum_active, active)
        time.sleep(0.04)
        with lock:
            active -= 1
        return {"text": path, "provider": "sarvam", "words": []}

    monkeypatch.setattr(transcriber, "transcribe_audio", fake_transcribe)
    progress = []
    results = asyncio.run(
        transcribe_sarvam_chunks_bounded(
            ["chunk-0", "chunk-1", "chunk-2", "chunk-3"],
            "telgish",
            progress_callback=lambda completed, total: progress.append(
                (completed, total)
            ),
        )
    )
    assert maximum_active == 2
    assert [result["text"] for result in results] == [
        "chunk-0",
        "chunk-1",
        "chunk-2",
        "chunk-3",
    ]
    assert progress[-1] == (4, 4)


def test_pipeline_does_not_pass_worker_progress_into_sarvam_event_loop(
    monkeypatch,
):
    source = pipeline_main.run_pipeline.__code__
    assert "on_parallel_progress" not in source.co_names
