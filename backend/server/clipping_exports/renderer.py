from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any

from server.clipping_jobs.errors import ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext
from server.clipping_storage.models import ProbeSource
from server.headless_export import ExportStageError, export_headless
from server.media_probe.config import MediaProbeConfig
from server.media_probe.ffprobe import FFprobeRunner
from server.media_variants.config import MediaVariantConfig
from server.media_variants.ffmpeg import FFmpegRunner


def _atempo(rate: float) -> str:
    filters: list[str] = []
    remaining = rate
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5
    while remaining > 2:
        filters.append("atempo=2.0")
        remaining /= 2
    filters.append(f"atempo={remaining:.8f}")
    return ",".join(filters)


def edl_arguments(
    edl: dict[str, Any], output_path: Path, *, has_audio: bool
) -> tuple[str, ...]:
    entries = sorted(edl["entries"], key=lambda item: item["order"])
    if not entries:
        raise ProcessingJobFailure(
            "export_empty_timeline",
            "The clipping timeline has no enabled ranges",
            retryable=False,
        )
    filters: list[str] = []
    video_labels: list[str] = []
    audio_labels: list[str] = []
    for index, entry in enumerate(entries):
        start = entry["sourceStartMs"] / 1000
        end = entry["sourceEndMs"] / 1000
        rate = float(entry["playbackRate"])
        filters.append(
            f"[0:v]trim=start={start:.6f}:end={end:.6f},"
            f"setpts=(PTS-STARTPTS)/{rate:.8f}[v{index}]"
        )
        video_labels.append(f"[v{index}]")
        if has_audio:
            filters.append(
                f"[0:a]atrim=start={start:.6f}:end={end:.6f},"
                f"asetpts=PTS-STARTPTS,{_atempo(rate)}[a{index}]"
            )
            audio_labels.append(f"[a{index}]")
    concat_inputs = "".join(
        video_labels[index] + (audio_labels[index] if has_audio else "")
        for index in range(len(entries))
    )
    filters.append(
        f"{concat_inputs}concat=n={len(entries)}:v=1:a={1 if has_audio else 0}"
        f"[vout]{'[aout]' if has_audio else ''}"
    )
    args = [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[vout]",
    ]
    if has_audio:
        args.extend(["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"])
    args.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    )
    return tuple(args)


def caption_render_input(project: dict[str, Any]) -> tuple[str, str, str]:
    records = project.get("capinstaCaptionDocuments") or []
    if len(records) != 1 or not isinstance(records[0], dict):
        raise ProcessingJobFailure(
            "export_captions_missing",
            "The converted project has no renderable caption document",
            retryable=False,
        )
    document = records[0].get("document") or {}
    words = {
        item.get("id"): item
        for item in document.get("words") or []
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    captions = []
    for clip in document.get("clips") or []:
        if not isinstance(clip, dict):
            continue
        captions.append(
            {
                "id": clip.get("id"),
                "text": clip.get("text", ""),
                "start": clip.get("start"),
                "end": clip.get("end"),
                "stylePresetId": clip.get("stylePresetId"),
                "style": clip.get("style"),
                "words": [
                    words[word_id]
                    for word_id in clip.get("wordIds") or []
                    if word_id in words
                ],
            }
        )
    if not captions:
        raise ProcessingJobFailure(
            "export_captions_missing",
            "The converted caption document is empty",
            retryable=False,
        )
    style = document.get("styleConfig")
    if not isinstance(style, dict):
        style = {}
    return (
        json.dumps(captions, separators=(",", ":"), ensure_ascii=False),
        str(
            document.get("stylePresetId")
            or captions[0].get("stylePresetId")
            or "word_highlight_box"
        ),
        json.dumps(style, separators=(",", ":"), ensure_ascii=False),
    )


async def source_has_audio(source: ProbeSource, context: JobExecutionContext) -> bool:
    runner = FFprobeRunner(MediaProbeConfig())
    raw = await runner.run(
        source,
        job_timeout_seconds=context.execution_timeout_seconds,
        cancellation_check=context.cancellation_callback,
        cancellation_event=context.cancellation_event,
        lease_lost_event=context.lease_lost_event,
        stop_event=context.shutdown_event,
    )
    payload = json.loads(raw)
    return any(item.get("codec_type") == "audio" for item in payload.get("streams", []))


async def render_project(
    *,
    context: JobExecutionContext,
    source: ProbeSource,
    edl: dict[str, Any],
    converted_project: dict[str, Any],
    workspace: Path,
    maximum_output_bytes: int,
    timeout_seconds: int,
    include_captions: bool = True,
) -> Path:
    has_audio = await source_has_audio(source, context)
    prepared = workspace / "prepared-timeline.mp4"
    ffmpeg_config = MediaVariantConfig()
    runner = FFmpegRunner(ffmpeg_config)

    async def progress(value: float) -> None:
        await context.heartbeat(
            progress=min(20 + value * 0.35, 50), current_stage="preparing_render"
        )

    await runner.run(
        source,
        arguments=edl_arguments(edl, prepared, has_audio=has_audio),
        duration_ms=edl["outputDurationMs"],
        timeout_seconds=timeout_seconds,
        job_timeout_seconds=context.execution_timeout_seconds,
        cancellation_check=context.cancellation_callback,
        cancellation_event=context.cancellation_event,
        lease_lost_event=context.lease_lost_event,
        stop_event=context.shutdown_event,
        progress_callback=progress,
    )
    captions_json, theme, style_json = (
        caption_render_input(converted_project)
        if include_captions
        else ("[]", "word_highlight_box", "{}")
    )
    settings = converted_project["settings"]
    canvas = settings["canvasSize"]
    fps_value = settings.get("fps") or {}
    fps = round(
        int(fps_value.get("numerator") or 30) / int(fps_value.get("denominator") or 1)
    )

    async def render_progress(stage: str, percent: int, details: str) -> None:
        del stage, details
        await context.raise_if_cancelled()
        await context.heartbeat(
            progress=max(50, min(84, 50 + percent * 0.34)),
            current_stage="rendering",
        )

    try:
        rendered = await export_headless(
            job_id=str(context.job_id),
            video_path=str(prepared),
            captions_json=captions_json,
            theme=theme,
            resolution=f"{canvas['width']}x{canvas['height']}",
            progress_callback=render_progress,
            style_config_json=style_json,
            composition_json=json.dumps(
                converted_project, separators=(",", ":"), ensure_ascii=False
            ),
            export_width=canvas["width"],
            export_height=canvas["height"],
            export_fps=max(1, min(60, fps)),
            include_audio=has_audio,
            quality="standard",
            export_mode="full_video",
            background_color=(settings.get("background") or {}).get("color", "#000000"),
            duration_override=edl["outputDurationMs"] / 1000,
            duration_source="rust-edl",
            hardware_acceleration=False,
        )
    except ExportStageError as exc:
        raise ProcessingJobFailure(
            "renderer_failed", "The existing Capinsta renderer failed", retryable=False
        ) from exc
    output = workspace / "export.mp4"
    await asyncio.to_thread(shutil.move, rendered, output)
    if not output.is_file() or output.stat().st_size <= 0:
        raise ProcessingJobFailure(
            "renderer_output_missing",
            "The renderer did not create an output",
            retryable=False,
        )
    if output.stat().st_size > maximum_output_bytes:
        raise ProcessingJobFailure(
            "renderer_output_too_large",
            "The rendered output exceeds its limit",
            retryable=False,
        )
    return output


__all__ = ["caption_render_input", "edl_arguments", "render_project"]
