"""Repeatable end-to-end benchmark for Capinsta's browser export engines.

Run from the repository root after building/serving the packaged render page:

    python backend/scripts/benchmark_export_pipeline.py \
      --render-url http://127.0.0.1:4173/render.html

The script creates deterministic synthetic source videos, runs each requested
engine, and writes measured JSON plus a Markdown table. It never fabricates or
extrapolates missing cases.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from server.benchmark_environment import configure_disposable_benchmark_environment

if os.getenv("CAPINSTA_ENV", "").strip().lower() != "benchmark":
    raise RuntimeError("BENCHMARK_ENV_UNSAFE: launch with CAPINSTA_ENV=benchmark")
_BENCHMARK_ROOT = Path(tempfile.mkdtemp(prefix="capinsta-export-benchmark-"))
configure_disposable_benchmark_environment(_BENCHMARK_ROOT)

from server.headless_export import export_headless


@dataclass(frozen=True)
class BenchmarkCase:
    name: str
    duration: int
    width: int
    height: int
    fps: int
    mode: str
    include_audio: bool


CASES = {
    "A": BenchmarkCase("A", 30, 720, 1280, 24, "full_video", True),
    "B": BenchmarkCase("B", 60, 1080, 1920, 24, "full_video", True),
    "C": BenchmarkCase("C", 60, 1080, 1920, 24, "captions_only", False),
    "D": BenchmarkCase("D", 120, 1080, 1920, 24, "full_video", True),
}

ENGINE_ENV = {
    "legacy": {
        "EXPORT_FFMPEG_THREADS": "1",
        "EXPORT_SPARSE_RENDER_ENABLED": "false",
        "EXPORT_RENDER_PAGE_RECYCLE_FRAMES": "450",
        "EXPORT_CLEAN_CHECK_INTERVAL_FRAMES": "1",
        "EXPORT_LEGACY_CAPTIONS_ONLY_DISK_PIPELINE": "true",
    },
    "optimized": {
        "EXPORT_FFMPEG_THREADS": "auto",
        "EXPORT_SPARSE_RENDER_ENABLED": "false",
        "EXPORT_RENDER_PAGE_RECYCLE_FRAMES": "0",
        "EXPORT_CLEAN_CHECK_INTERVAL_FRAMES": "0",
        "EXPORT_LEGACY_CAPTIONS_ONLY_DISK_PIPELINE": "false",
    },
    "sparse": {
        "EXPORT_FFMPEG_THREADS": "auto",
        "EXPORT_SPARSE_RENDER_ENABLED": "true",
        "EXPORT_SPARSE_RENDER_THEMES": "word_highlight_box",
        "EXPORT_SPARSE_MIN_FRAME_REDUCTION_PERCENT": "5",
        "EXPORT_RENDER_PAGE_RECYCLE_FRAMES": "0",
        "EXPORT_CLEAN_CHECK_INTERVAL_FRAMES": "0",
        "EXPORT_LEGACY_CAPTIONS_ONLY_DISK_PIPELINE": "false",
    },
}


def make_captions(duration: int) -> list[dict[str, object]]:
    captions: list[dict[str, object]] = []
    style = {
        "animation": {
            "wordEffect": "highlight",
            "type": "none",
            "entrance": "none",
            "strength": 0,
        }
    }
    caption_index = 0
    for start in range(1, duration, 4):
        end = min(float(duration), start + 3.0)
        if end <= start:
            continue
        word_duration = (end - start) / 3
        words = []
        for word_index, text in enumerate(("fast", "caption", "render")):
            word_start = start + word_index * word_duration
            words.append(
                {
                    "id": f"w-{caption_index}-{word_index}",
                    "text": text,
                    "start": word_start,
                    "end": start + (word_index + 1) * word_duration,
                }
            )
        captions.append(
            {
                "id": f"c-{caption_index}",
                "start": float(start),
                "end": end,
                "text": "fast caption render",
                "words": words,
                "stylePresetId": "word_highlight_box",
                "style": style,
            }
        )
        caption_index += 1
    return captions


def ensure_source(path: Path, case: BenchmarkCase) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c=0x1d2939:s={case.width}x{case.height}:r={case.fps}:d={case.duration}",
        "-f",
        "lavfi",
        "-i",
        f"sine=frequency=440:sample_rate=48000:duration={case.duration}",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        str(path),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


async def run_one(case: BenchmarkCase, engine: str, source: Path) -> dict[str, object]:
    for key, value in ENGINE_ENV[engine].items():
        os.environ[key] = value
    summary: dict[str, object] = {}

    async def progress(_status: str, _percent: int, _message: str) -> None:
        return None

    async def capture_metrics(payload: dict[str, object]) -> None:
        summary.update(payload)

    job_id = f"benchmark-{case.name.lower()}-{engine}"
    started = time.perf_counter()
    output = await export_headless(
        job_id=job_id,
        video_path=str(source),
        captions_json=json.dumps(make_captions(case.duration)),
        theme="word_highlight_box",
        resolution="custom",
        progress_callback=progress,
        style_config_json=json.dumps(
            {"animation": {"wordEffect": "highlight", "type": "none", "entrance": "none"}}
        ),
        export_width=case.width,
        export_height=case.height,
        export_fps=case.fps,
        include_audio=case.include_audio,
        quality="standard",
        export_mode=case.mode,
        background_color="#00FF00",
        duration_override=case.duration,
        duration_source="benchmark",
        performance_callback=capture_metrics,
    )
    wall_seconds = time.perf_counter() - started
    output_path = Path(output)
    summary.update(
        {
            "case": case.name,
            "requestedEngine": engine,
            "wallSeconds": round(wall_seconds, 6),
            "timePerOutputSecond": round(wall_seconds / case.duration, 6),
            "effectiveCapturedFramesPerSecond": round(
                float(summary.get("capturedFrames", 0)) / wall_seconds, 6
            ),
            "outputBytes": output_path.stat().st_size,
            "outputPath": str(output_path),
        }
    )
    return summary


def markdown_table(results: list[dict[str, object]]) -> str:
    lines = [
        "| Case | Requested | Actual | Seconds | Captured frames | Reduction | Output bytes | Restarts |",
        "|---|---|---|---:|---:|---:|---:|---:|",
    ]
    for row in results:
        lines.append(
            "| {case} | {requestedEngine} | {renderEngine} | {wallSeconds:.3f} | "
            "{capturedFrames} | {frameReductionPercent:.1f}% | {outputBytes} | {rendererRestarts} |".format(
                **row
            )
        )
    return "\n".join(lines) + "\n"


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--render-url", required=True)
    parser.add_argument("--cases", nargs="+", choices=sorted(CASES), default=list(CASES))
    parser.add_argument(
        "--engines", nargs="+", choices=sorted(ENGINE_ENV), default=["legacy", "optimized", "sparse"]
    )
    parser.add_argument(
        "--output", type=Path, default=BACKEND_DIR / "benchmark-results" / "export-benchmark.json"
    )
    args = parser.parse_args()
    os.environ["RENDER_PAGE_URL"] = args.render_url
    os.environ["EXPORT_RENDER_SAFE_MODE"] = "false"
    os.environ["EXPORT_MAX_LONG_EDGE"] = "0"
    os.environ["EXPORT_MAX_FPS"] = "120"

    results: list[dict[str, object]] = []
    source_dir = args.output.parent / "sources"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    table_path = args.output.with_suffix(".md")
    for case_name in args.cases:
        case = CASES[case_name]
        source = source_dir / f"case-{case.name}-{case.duration}s-{case.width}x{case.height}-{case.fps}.mp4"
        ensure_source(source, case)
        for engine in args.engines:
            print(f"[benchmark] case={case.name} engine={engine}", flush=True)
            results.append(await run_one(case, engine, source))
            # Persist every completed run so an interrupted multi-hour legacy
            # matrix never discards measurements that already finished.
            args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
            table_path.write_text(markdown_table(results), encoding="utf-8")

    args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    table_path.write_text(markdown_table(results), encoding="utf-8")
    print(markdown_table(results))
    print(f"JSON: {args.output}")
    print(f"Markdown: {table_path}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        shutil.rmtree(_BENCHMARK_ROOT, ignore_errors=True)
