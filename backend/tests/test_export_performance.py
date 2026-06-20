import os
import sys
import asyncio

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from server.headless_export import (
    ExportPerformanceMetrics,
    _looks_like_browser_disconnect,
    _playwright_session,
    _should_recreate_captions_chunk,
    _should_run_clean_check,
    _should_schedule_page_recycle,
    build_full_video_filter_graph,
    resolve_ffmpeg_preset,
    resolve_ffmpeg_threads,
)


def test_performance_summary_aggregates_frame_metrics():
    metrics = ExportPerformanceMetrics(
        export_job_id="job-1",
        mode="full_video",
        duration_seconds=2,
        fps=24,
        total_frames=48,
        legacy_frames=48,
        queue_wait_seconds=0.25,
    )
    metrics.record_screenshot(0.08, 100_000)
    metrics.record_screenshot(0.12, 140_000)
    metrics.record_ffmpeg_drain(0.01)
    metrics.record_ffmpeg_drain(0.03)

    summary = metrics.to_summary(1.5)

    assert summary["event"] == "export_performance_summary"
    assert summary["averageScreenshotMs"] == 100.0
    assert summary["maximumScreenshotMs"] == 120.0
    assert summary["averagePngBytes"] == 120_000
    assert summary["maximumPngBytes"] == 140_000
    assert summary["averageFfmpegDrainMs"] == 20.0
    assert summary["queueWaitSeconds"] == 0.25


def test_healthy_export_has_no_scheduled_page_recreation_by_default():
    assert all(not _should_schedule_page_recycle(frame, 0) for frame in range(10_000))


def test_positive_recycle_interval_remains_compatibility_escape_hatch():
    assert not _should_schedule_page_recycle(449, 450)
    assert _should_schedule_page_recycle(450, 450)


def test_captions_chunk_only_recreates_on_retry():
    assert not _should_recreate_captions_chunk(0)
    assert _should_recreate_captions_chunk(1)


def test_clean_check_interval_zero_has_no_per_frame_scans():
    assert all(not _should_run_clean_check(frame, 0) for frame in range(10_000))


def test_positive_clean_check_interval_is_respected():
    assert not _should_run_clean_check(0, 120)
    assert not _should_run_clean_check(119, 120)
    assert _should_run_clean_check(120, 120)


def test_ffmpeg_auto_threads_reserve_cpu_for_chromium():
    assert resolve_ffmpeg_threads("auto", cpu_count=1) == 1
    assert resolve_ffmpeg_threads("auto", cpu_count=2) == 2
    assert resolve_ffmpeg_threads("auto", cpu_count=4) == 2
    assert resolve_ffmpeg_threads("auto", cpu_count=32) == 2
    assert resolve_ffmpeg_threads("2", cpu_count=32) == 2
    assert resolve_ffmpeg_threads("8", cpu_count=32) == 2
    assert resolve_ffmpeg_threads("2", cpu_count=1) == 1


@pytest.mark.parametrize(
    "message",
    [
        "unable to perform operation on <WriteUnixTransport closed=True>; the handler is closed",
        "TargetClosedError: Browser closed",
        "playwright._impl._errors.Error: Connection closed",
        "Page closed",
    ],
)
def test_playwright_disconnect_errors_are_recoverable(message):
    assert _looks_like_browser_disconnect(RuntimeError(message))


def test_non_browser_capture_errors_are_not_recoverable():
    assert not _looks_like_browser_disconnect(RuntimeError("PNG encoding failed"))


def test_dead_playwright_transport_does_not_escape_session_cleanup():
    class DeadPlaywright:
        async def stop(self):
            raise RuntimeError(
                "unable to perform operation on <WriteUnixTransport closed=True>; "
                "the handler is closed"
            )

    class FactoryContext:
        async def start(self):
            return DeadPlaywright()

    def factory():
        return FactoryContext()

    async def run():
        async with _playwright_session(factory) as playwright:
            assert isinstance(playwright, DeadPlaywright)

    asyncio.run(run())


def test_ffmpeg_presets_are_valid_for_software_and_nvenc_encoders():
    assert resolve_ffmpeg_preset(False, fastest=True) == "ultrafast"
    assert resolve_ffmpeg_preset(False, fastest=False) == "veryfast"
    assert resolve_ffmpeg_preset(True, fastest=True) == "p1"
    assert resolve_ffmpeg_preset(True, fastest=False) == "p3"


def test_filter_graph_avoids_matching_source_and_overlay_scales():
    graph = build_full_video_filter_graph((1080, 1920), (1080, 1920), (1080, 1920))
    assert "[0:v]null[base]" in graph
    assert "[1:v]format=rgba[ov]" in graph
    assert "scale=" not in graph


def test_filter_graph_scales_only_mismatched_source():
    graph = build_full_video_filter_graph((1920, 1080), (1080, 1920), (1080, 1920))
    assert "[0:v]scale=1080:1920" in graph
    assert "[1:v]format=rgba[ov]" in graph
    assert "[1:v]scale=" not in graph


def test_filter_graph_scales_only_mismatched_overlay():
    graph = build_full_video_filter_graph((720, 1280), (360, 640), (720, 1280))
    assert "[0:v]null[base]" in graph
    assert "[1:v]scale=720:1280" in graph


def test_filter_graph_supports_landscape_and_square_outputs():
    landscape = build_full_video_filter_graph((1280, 720), (1280, 720), (1280, 720))
    square = build_full_video_filter_graph((1920, 1080), (1080, 1080), (1080, 1080))
    assert "scale=" not in landscape
    assert "[0:v]scale=1080:1080" in square
    assert "[1:v]format=rgba[ov]" in square
