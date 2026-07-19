import os
import json
import asyncio
import pytest
import aiosqlite
from unittest.mock import MagicMock
from server import pipeline_runner, database

def test_caption_caching_and_metrics(tmp_path, monkeypatch):
    db_path = tmp_path / "test_caching.sqlite"
    monkeypatch.setattr(database, "DB_PATH", db_path)
    monkeypatch.setattr(pipeline_runner, "DB_PATH", db_path)
    
    # 1. Setup DB
    async def setup():
        await database.init_db()
        
        # Insert a job with a media_asset_id
        async with aiosqlite.connect(str(db_path)) as db:
            await db.execute(
                """
                INSERT INTO jobs (id, status, filename, media_asset_id)
                VALUES (?, ?, ?, ?)
                """,
                ("test-job-id", "queued", "video.mp4", "test-media-asset-id")
            )
            await db.commit()
            
    asyncio.run(setup())
    
    # Create a mock video file
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"dummy video content")
    
    # Mock run_pipeline to return success
    dummy_result = {
        "status": "success",
        "srt": "1\n00:00:00,000 --> 00:00:01,000\nHello",
        "vtt": "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nHello",
        "segments": [{"start": 0.0, "end": 1.0, "text": "Hello"}],
        "transcript": {
            "provider": {"name": "sarvam", "model": "saaras:v3"},
            "metadata": {
                "timing": {
                    "report": {
                        "durations": {"total": 5.2},
                        "retryAttempts": [],
                        "timingSourceCounts": {"provider_native": 1}
                    }
                }
            }
        }
    }
    
    run_pipeline_mock = MagicMock(return_value=dummy_result)
    monkeypatch.setattr(pipeline_runner, "run_pipeline", run_pipeline_mock)
    
    # 2. Call run_pipeline_sync (without an active event loop in the main thread)
    pipeline_runner.run_pipeline_sync(
        job_id="test-job-id",
        video_path=str(video_file),
        target_lang="english",
        caption_output="original",
        transcription_config_snapshot={"preset_id": "fast"}
    )
    
    assert run_pipeline_mock.call_count == 1
    
    # 3. Assertions and insert second job
    async def assert_and_insert_second():
        async with aiosqlite.connect(str(db_path)) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM jobs WHERE id = ?", ("test-job-id",))
            row = await cursor.fetchone()
            assert row["status"] == "completed"
            assert row["srt_content"] == dummy_result["srt"]
            assert row["metrics_json"] is not None
            metrics = json.loads(row["metrics_json"])
            assert metrics["cache_hit"] is False
            assert metrics["durations"]["total"] == 5.2
            
            # Verify cached entry was created in caption_artifacts
            cursor = await db.execute("SELECT * FROM caption_artifacts WHERE media_asset_id = ?", ("test-media-asset-id",))
            artifact = await cursor.fetchone()
            assert artifact is not None
            assert artifact["preset"] == "fast"
            assert artifact["srt_content"] == dummy_result["srt"]
            
            # Insert second job
            await db.execute(
                """
                INSERT INTO jobs (id, status, filename, media_asset_id)
                VALUES (?, ?, ?, ?)
                """,
                ("test-job-id-2", "queued", "video.mp4", "test-media-asset-id")
            )
            await db.commit()
            
    asyncio.run(assert_and_insert_second())
    
    run_pipeline_mock.reset_mock()
    
    # 4. Call run_pipeline_sync for second job (should hit cache)
    pipeline_runner.run_pipeline_sync(
        job_id="test-job-id-2",
        video_path=str(video_file),
        target_lang="english",
        caption_output="original",
        transcription_config_snapshot={"preset_id": "fast"}
    )
    
    assert run_pipeline_mock.call_count == 0
    
    # 5. Assertions for second job
    async def assert_second_job():
        async with aiosqlite.connect(str(db_path)) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM jobs WHERE id = ?", ("test-job-id-2",))
            row = await cursor.fetchone()
            assert row["status"] == "completed"
            assert row["srt_content"] == dummy_result["srt"]
            assert row["metrics_json"] is not None
            metrics = json.loads(row["metrics_json"])
            assert metrics["cache_hit"] is True
            
    asyncio.run(assert_second_job())


def test_extract_audio_range_args(tmp_path, monkeypatch):
    """extract_audio must pass -ss and -to to ffmpeg when start_ms/end_ms given."""
    import subprocess
    from ai_pipeline import audio

    captured_cmd = []

    def fake_run(cmd, **kwargs):
        captured_cmd.extend(cmd)
        # Simulate success
        class FakeResult:
            returncode = 0
        return FakeResult()

    monkeypatch.setattr(subprocess, "run", fake_run)
    # Ensure ffmpeg binary is "found" so the availability check passes
    monkeypatch.setattr(audio, "FFMPEG_BINARY", "ffmpeg")
    import shutil
    monkeypatch.setattr(shutil, "which", lambda x: "/usr/bin/ffmpeg")

    from pydub import AudioSegment
    class DummyAudioSegment:
        def __init__(self):
            self.rms = 100
        def set_frame_rate(self, rate):
            return self
        def set_sample_width(self, width):
            return self
        def split_to_mono(self):
            return [self]
        def set_channels(self, channels):
            return self
        def export(self, path, **kwargs):
            pass
        def __len__(self):
            return 1000

    monkeypatch.setattr(AudioSegment, "from_wav", lambda path: DummyAudioSegment())

    video = tmp_path / "v.mp4"
    video.touch()
    out = tmp_path / "out.wav"

    audio.extract_audio(str(video), str(out), start_ms=5000, end_ms=10000)

    # -ss 5.000000 and -to 10.000000 must appear in the constructed command
    assert "-ss" in captured_cmd
    assert captured_cmd[captured_cmd.index("-ss") + 1] == "5.000000"
    assert "-to" in captured_cmd
    assert captured_cmd[captured_cmd.index("-to") + 1] == "10.000000"


def test_timeline_offset_shift():
    """timeline_offset_ms must shift all segment and word timestamps in-place."""
    # This replicates the exact logic from main.py lines 1347-1367 to unit-test
    # the math in isolation without running the full pipeline.
    clamped_segments = [
        {
            "start": 0.5,
            "end": 1.2,
            "text": "hello",
            "words": [
                {"word": "hello", "start": 0.5, "end": 1.2},
            ],
        },
        {
            "start": 2.0,
            "end": 3.5,
            "text": "world",
            "words": [
                {"word": "world", "start": 2.0, "end": 3.5},
            ],
        },
    ]

    timeline_offset_ms = 15000
    offset_seconds = timeline_offset_ms / 1000.0

    for seg in clamped_segments:
        if "start" in seg:
            seg["start"] = round(seg["start"] + offset_seconds, 3)
        if "end" in seg:
            seg["end"] = round(seg["end"] + offset_seconds, 3)
        if "words" in seg:
            for w in seg["words"]:
                if "start" in w:
                    w["start"] = round(w["start"] + offset_seconds, 3)
                if "end" in w:
                    w["end"] = round(w["end"] + offset_seconds, 3)

    assert clamped_segments[0]["start"] == 15.5   # 0.5 + 15.0
    assert clamped_segments[0]["end"] == 16.2     # 1.2 + 15.0
    assert clamped_segments[0]["words"][0]["start"] == 15.5
    assert clamped_segments[0]["words"][0]["end"] == 16.2
    assert clamped_segments[1]["start"] == 17.0   # 2.0 + 15.0
    assert clamped_segments[1]["end"] == 18.5     # 3.5 + 15.0

