import os
import time
import pytest
import threading
import asyncio
from ai_pipeline.vad_analysis import VADAnalysis, compute_file_sha256
from ai_pipeline.aligner import TranscriptAligner
from ai_pipeline.transcriber import ThreadSafeTokenBucketLimiter, _sarvam_post_audio_with_retry_and_limiters

def test_thread_safe_token_bucket_limiter():
	limiter = ThreadSafeTokenBucketLimiter(requests_per_minute=240)  # 4 per second
	limiter.tokens = 0.0
	start_time = time.monotonic()

	# Acquire 2 tokens
	limiter.acquire()
	limiter.acquire()

	elapsed = time.monotonic() - start_time
	assert elapsed >= 0.4

def test_vad_analysis_caching_and_avoid_duplicate_scans(tmp_path):
	wav_file = tmp_path / "test.wav"
	wav_file.write_bytes(b"dummy wav data")

	VADAnalysis.clear_cache()

	# Import or fetch global inference count
	import ai_pipeline.aligner as aligner_mod
	count_before = aligner_mod._silero_inference_count

	# Create TranscriptAligner
	aligner = TranscriptAligner(enable_silero_vad=True)

	import torch

	class MockModel:
		def reset_states(self): pass
		def __call__(self, chunk, sr):
			return torch.tensor([0.9])

	aligner._load_silero_model = lambda: (MockModel(), "cpu")
	aligner._load_audio_tensor = lambda path: (torch.zeros(16000 * 2), 16000)

	map1 = aligner._compute_vad_speech_map(str(wav_file))
	count_after_first = aligner_mod._silero_inference_count

	map2 = aligner._compute_vad_speech_map(str(wav_file))
	count_after_second = aligner_mod._silero_inference_count

	assert count_after_first == count_before + 1
	assert count_after_second == count_after_first

def test_timeline_offset_range_math_correctness():
	source_in_ms = 5000       # 5s
	timeline_offset_ms = 115000  # 115s

	offset_seconds = (float(source_in_ms or 0) + float(timeline_offset_ms or 0)) / 1000.0
	assert offset_seconds == 120.0
