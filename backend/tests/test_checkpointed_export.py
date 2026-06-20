import ast
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from server.headless_export import (
    _build_ffconcat_manifest,
    _capture_chunks,
    _capture_progress,
    _discard_capture_range,
)


ROOT = Path(__file__).resolve().parents[1]
HEADLESS_SOURCE = (ROOT / "server" / "headless_export.py").read_text("utf-8")
JOBS_SOURCE = (ROOT / "server" / "api" / "export_jobs.py").read_text("utf-8")


def test_export_job_calls_export_headless_once():
    tree = ast.parse(JOBS_SOURCE)
    run_job = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
        and node.name == "_run_export_job"
    )
    calls = [
        node
        for node in ast.walk(run_job)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "export_headless"
    ]
    assert len(calls) == 1


def test_complete_export_recursive_retry_is_removed():
    tree = ast.parse(HEADLESS_SOURCE)
    export_function = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "export_headless"
    )
    recursive_calls = [
        node
        for node in ast.walk(export_function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "export_headless"
    ]
    # The only self-call is the Windows proactor-loop handoff at function entry.
    assert len(recursive_calls) == 1
    assert "retry_captions_stream" not in HEADLESS_SOURCE
    assert "EXPORT_STREAM_RETRIES" not in HEADLESS_SOURCE


def test_capture_chunks_are_checkpointed_without_overlap():
    assert _capture_chunks(450, 200) == [(0, 200), (200, 400), (400, 450)]


def test_failed_chunk_cleanup_preserves_completed_chunks(tmp_path):
    paths = [tmp_path / f"frame_{index:06d}.png" for index in range(6)]
    for path in paths:
        path.write_bytes(b"png")
    _discard_capture_range(paths, 3, 6)
    assert all(path.exists() for path in paths[:3])
    assert all(not path.exists() for path in paths[3:])


def test_capture_progress_never_decreases():
    values = [_capture_progress(completed, 10) for completed in range(11)]
    assert values == sorted(values)
    assert values[0] == 5
    assert values[-1] == 80


def test_ffmpeg_starts_after_capture_completeness_check():
    completeness = HEADLESS_SOURCE.index('missing = [str(path) for path in frame_paths')
    ffmpeg_start = HEADLESS_SOURCE.index('"checkpointed_ffmpeg_encode_started"')
    assert completeness < ffmpeg_start


def test_output_must_be_non_empty():
    assert "if not output.is_file() or output.stat().st_size <= 0" in HEADLESS_SOURCE


def test_sparse_concat_manifest_is_valid(tmp_path):
    frames = [tmp_path / "frame_000000.png", tmp_path / "frame_000001.png"]
    for frame in frames:
        frame.write_bytes(b"png")
    manifest = _build_ffconcat_manifest(frames, [12, 24], 24)
    assert manifest.startswith("ffconcat version 1.0\n")
    assert "duration 0.500000000" in manifest
    assert "duration 1.000000000" in manifest
    assert manifest.count("file '") == 3
