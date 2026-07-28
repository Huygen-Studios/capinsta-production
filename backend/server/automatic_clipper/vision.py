from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

import numpy as np

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext

from .contracts import NormalizedFaceBoxV1

_PTS = re.compile(rb"pts_time:([0-9]+(?:\.[0-9]+)?)")


async def _communicate_bounded(
    command: list[str],
    *,
    context: JobExecutionContext,
    timeout_seconds: int,
    maximum_stdout_bytes: int,
    maximum_stderr_bytes: int = 1_048_576,
) -> tuple[bytes, bytes]:
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        raise ProcessingJobFailure(
            "smart_reframe_unavailable",
            "Smart framing media analysis could not start",
            retryable=True,
        ) from exc
    assert process.stdout and process.stderr

    async def read(stream: asyncio.StreamReader, maximum: int) -> bytes:
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = await stream.read(min(65_536, maximum + 1 - total))
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                raise ProcessingJobFailure(
                    "smart_reframe_output_too_large",
                    "Smart framing analysis exceeded its output limit",
                    retryable=False,
                )

    stdout_task = asyncio.create_task(read(process.stdout, maximum_stdout_bytes))
    stderr_task = asyncio.create_task(read(process.stderr, maximum_stderr_bytes))
    wait_task = asyncio.create_task(process.wait())
    started = asyncio.get_running_loop().time()
    try:
        while not wait_task.done():
            if context.lease_lost_event.is_set():
                raise JobOrchestrationError(
                    "job_lease_lost", "The smart framing job lease was lost"
                )
            if (
                context.shutdown_event.is_set()
                or context.cancellation_event.is_set()
                or await context.cancellation_callback()
            ):
                raise asyncio.CancelledError
            if asyncio.get_running_loop().time() - started >= timeout_seconds:
                raise ProcessingJobFailure(
                    "smart_reframe_timeout",
                    "Smart framing media analysis timed out",
                    retryable=True,
                )
            await asyncio.sleep(0.05)
        stdout, stderr = await asyncio.gather(stdout_task, stderr_task)
        if process.returncode != 0:
            raise ProcessingJobFailure(
                "smart_reframe_analysis_failed",
                "Smart framing could not analyze this media",
                retryable=False,
            )
        return stdout, stderr
    except BaseException:
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=3)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
        raise
    finally:
        for task in (stdout_task, stderr_task, wait_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(
            stdout_task, stderr_task, wait_task, return_exceptions=True
        )


async def detect_scene_boundaries(
    source: Path,
    *,
    source_start_ms: int,
    source_end_ms: int,
    ffmpeg_path: str,
    context: JobExecutionContext,
    timeout_seconds: int,
) -> list[int]:
    duration_seconds = (source_end_ms - source_start_ms) / 1000
    command = [
        ffmpeg_path,
        "-hide_banner",
        "-nostdin",
        "-ss",
        f"{source_start_ms / 1000:.3f}",
        "-t",
        f"{duration_seconds:.3f}",
        "-i",
        str(source),
        "-an",
        "-vf",
        "select='gt(scene,0.35)',showinfo",
        "-vsync",
        "vfr",
        "-f",
        "null",
        "-",
    ]
    _, stderr = await _communicate_bounded(
        command,
        context=context,
        timeout_seconds=timeout_seconds,
        maximum_stdout_bytes=1,
    )
    boundaries = {
        source_start_ms + int(round(float(match.group(1)) * 1000))
        for match in _PTS.finditer(stderr)
    }
    return sorted(
        value
        for value in boundaries
        if source_start_ms + 750 < value < source_end_ms - 750
    )


def _detector(model_path: Path) -> tuple[Any | None, Any | None, str | None]:
    try:
        import mediapipe as mp
    except ImportError:
        return None, None, None
    if not model_path.is_file():
        return None, None, None
    try:
        vision = mp.tasks.vision
        options = vision.FaceDetectorOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            min_detection_confidence=0.5,
            min_suppression_threshold=0.3,
        )
        detector = vision.FaceDetector.create_from_options(options)
    except (AttributeError, RuntimeError, ValueError):
        return None, None, None
    version = (
        f"mediapipe-{getattr(mp, '__version__', 'unknown')}"
        "+blazeface-short-range-float16-v1"
    )
    return detector, mp, version


def _assign_track(
    box: tuple[float, float, float, float],
    tracks: dict[int, tuple[float, float]],
) -> int:
    center = (box[0] + box[2] / 2, box[1] + box[3] / 2)
    nearest = min(
        tracks,
        key=lambda track_id: (
            tracks[track_id][0] - center[0]
        ) ** 2
        + (tracks[track_id][1] - center[1]) ** 2,
        default=None,
    )
    if nearest is None or (
        (tracks[nearest][0] - center[0]) ** 2
        + (tracks[nearest][1] - center[1]) ** 2
    ) > 0.08:
        nearest = max(tracks, default=0) + 1
    tracks[nearest] = center
    return nearest


async def detect_faces(
    source: Path,
    *,
    source_start_ms: int,
    source_end_ms: int,
    source_width: int,
    source_height: int,
    ffmpeg_path: str,
    sample_fps: int,
    maximum_frames: int,
    model_path: Path,
    scene_boundaries_ms: list[int],
    context: JobExecutionContext,
    timeout_seconds: int,
) -> tuple[list[NormalizedFaceBoxV1], str | None]:
    detector, mp, version = _detector(model_path)
    if detector is None or mp is None:
        return [], None
    width = 320
    height = max(
        2,
        min(320, int(round(width * source_height / max(1, source_width) / 2)) * 2),
    )
    duration_seconds = (source_end_ms - source_start_ms) / 1000
    effective_fps = min(
        sample_fps,
        max(1, int(maximum_frames / max(duration_seconds, 1))),
    )
    maximum_bytes = width * height * 3 * maximum_frames
    command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-ss",
        f"{source_start_ms / 1000:.3f}",
        "-t",
        f"{duration_seconds:.3f}",
        "-i",
        str(source),
        "-an",
        "-vf",
        f"fps={effective_fps},scale={width}:{height}",
        "-frames:v",
        str(maximum_frames),
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
    ]
    stdout, _ = await _communicate_bounded(
        command,
        context=context,
        timeout_seconds=timeout_seconds,
        maximum_stdout_bytes=maximum_bytes,
    )
    frame_bytes = width * height * 3
    frame_count = len(stdout) // frame_bytes
    detections: list[NormalizedFaceBoxV1] = []
    tracks: dict[int, tuple[float, float]] = {}
    boundaries = iter(sorted(scene_boundaries_ms))
    next_boundary = next(boundaries, None)
    try:
        for frame_index in range(frame_count):
            offset = frame_index * frame_bytes
            frame = np.frombuffer(
                stdout[offset : offset + frame_bytes], dtype=np.uint8
            ).reshape((height, width, 3))
            time_ms = source_start_ms + int(round(frame_index * 1000 / effective_fps))
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
            result = detector.detect_for_video(image, time_ms)
            while next_boundary is not None and time_ms >= next_boundary:
                tracks.clear()
                next_boundary = next(boundaries, None)
            for detected in result.detections:
                box = detected.bounding_box
                x = max(0.0, float(box.origin_x) / width)
                y = max(0.0, float(box.origin_y) / height)
                box_width = min(1.0 - x, max(0.001, float(box.width) / width))
                box_height = min(1.0 - y, max(0.001, float(box.height) / height))
                confidence = (
                    float(detected.categories[0].score)
                    if detected.categories
                    else 0.0
                )
                track_id = _assign_track(
                    (x, y, box_width, box_height), tracks
                )
                detections.append(
                    NormalizedFaceBoxV1(
                        timeMs=time_ms,
                        x=x,
                        y=y,
                        width=box_width,
                        height=box_height,
                        confidence=confidence,
                        trackId=track_id,
                    )
                )
    finally:
        detector.close()
    return detections, version


__all__ = ["detect_faces", "detect_scene_boundaries"]
