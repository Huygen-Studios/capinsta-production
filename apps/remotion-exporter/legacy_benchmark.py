"""Run the existing exporter against the exact 30-second Remotion fixture."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from server.benchmark_environment import configure_disposable_benchmark_environment  # noqa: E402

if os.getenv("CAPINSTA_ENV", "").strip().lower() != "benchmark":
    raise RuntimeError("BENCHMARK_ENV_UNSAFE: launch with CAPINSTA_ENV=benchmark")
_BENCHMARK_ROOT = Path(tempfile.mkdtemp(prefix="capinsta-legacy-benchmark-"))
configure_disposable_benchmark_environment(_BENCHMARK_ROOT)

from server.headless_export import export_headless  # noqa: E402


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--render-url", required=True)
    parser.add_argument("--props", type=Path, default=Path(__file__).parent / "fixtures/generated/ordinary-captions.json")
    args = parser.parse_args()
    payload = json.loads(args.props.read_text(encoding="utf-8"))
    document = payload["captions"]["document"]
    words = {word["id"]: word for word in document["words"]}
    captions = []
    for clip in document["clips"]:
        clip_words = [words[word_id] for word_id in clip["wordIds"]]
        captions.append({
            "id": clip["id"], "start": clip["start"], "end": clip["end"],
            "text": clip["text"], "words": clip_words,
            "theme": clip["stylePresetId"], "stylePresetId": clip["stylePresetId"],
            "style": document["style"],
        })
    source = Path(__file__).parent / "fixtures/generated/moving-source-30s.mp4"
    os.environ.update({
        "RENDER_PAGE_URL": args.render_url,
        "CAPINSTA_RENDER_TOKEN_SECRET": "development-render-token-secret-bypass",
        "EXPORT_RENDER_SAFE_MODE": "false",
        "EXPORT_MAX_LONG_EDGE": "0",
        "EXPORT_MAX_FPS": "120",
        "EXPORT_FFMPEG_THREADS": "auto",
        "EXPORT_SPARSE_RENDER_ENABLED": "true",
        "EXPORT_SPARSE_RENDER_THEMES": "*",
        "EXPORT_SPARSE_MIN_FRAME_REDUCTION_PERCENT": "5",
        "EXPORT_RENDER_PAGE_RECYCLE_FRAMES": "0",
        "EXPORT_CLEAN_CHECK_INTERVAL_FRAMES": "0",
        "EXPORT_LEGACY_CAPTIONS_ONLY_DISK_PIPELINE": "false",
    })
    metrics: dict[str, object] = {}

    async def progress(_status: str, _percent: int, _message: str) -> None:
        pass

    async def capture(value: dict[str, object]) -> None:
        metrics.update(value)

    started = time.perf_counter()
    output = await export_headless(
        job_id=f"remotion-comparison-{int(time.time())}", video_path=str(source),
        captions_json=json.dumps(captions), theme=document["stylePresetId"], resolution="custom",
        progress_callback=progress, style_config_json=json.dumps(document["style"]),
        export_width=1080, export_height=1920, export_fps=30, include_audio=True,
        quality="standard", export_mode="full_video", background_color="#000000",
        duration_override=30.0, duration_source="remotion_fixture", performance_callback=capture,
    )
    result = {"wallSeconds": time.perf_counter() - started, "output": output, **metrics}
    print(json.dumps({"event": "legacy_same_fixture_complete", **result}))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        shutil.rmtree(_BENCHMARK_ROOT, ignore_errors=True)
