import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from server.headless_export import export_headless
from server.render_engine import select_render_engine, sparse_compatibility_reason, build_sparse_caption_render_plan

os.environ["EXPORT_RENDER_SAFE_MODE"] = "false"
os.environ["CAPINSTA_RENDER_TOKEN_SECRET"] = "development-render-token-secret-bypass"

os.environ["RENDER_PAGE_URL"] = "http://127.0.0.1:8000/render.html"

def create_60s_fixture(path: Path) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "lavfi", "-i", "color=c=0x111827:s=720x1280:r=30:d=60",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=60",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(path)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

def build_60s_captions() -> list[dict[str, object]]:
    captions = []
    # 60s video with words every ~0.5s (120 total words across 15 captions)
    caption_index = 0
    for start in range(1, 60, 4):
        end = min(60.0, start + 3.5)
        if end <= start:
            continue
        words = []
        num_words = 6
        word_dur = (end - start) / num_words
        sample_words = ["welcome", "to", "capinsta", "fast", "video", "export"]
        for wi in range(num_words):
            w_start = start + wi * word_dur
            w_end = start + (wi + 1) * word_dur
            words.append({
                "id": f"w-{caption_index}-{wi}",
                "text": sample_words[wi % len(sample_words)],
                "start": float(w_start),
                "end": float(w_end)
            })
        captions.append({
            "id": f"c-{caption_index}",
            "start": float(start),
            "end": float(end),
            "text": "welcome to capinsta fast video export",
            "words": words
        })
        caption_index += 1
    return captions

async def run_single_audit(preset: str, fixture_path: Path):
    captions = build_60s_captions()
    captions_json = json.dumps(captions)
    
    style_configs = {
        "minimal": {"animation": {"wordEffect": "none", "type": "none", "entrance": "none"}},
        "word_highlight_box": {"animation": {"wordEffect": "highlight", "type": "none", "entrance": "none"}},
        "whiteout_editorial": {
            "animation": {"wordEffect": "reveal", "type": "none", "entrance": "fade"},
            "fontFamily": "Montserrat", "fontSize": 112, "fontWeight": 900
        }
    }
    style_config_json = json.dumps(style_configs.get(preset, {}))
    
    # Engine trace
    sparse_enabled = os.getenv("EXPORT_SPARSE_RENDER_ENABLED", "true").lower() in ("true", "1")
    sparse_themes = set(os.getenv("EXPORT_SPARSE_RENDER_THEMES", "*").split(","))
    engine, reason = select_render_engine(preset, style_configs.get(preset, {}), "full_video", sparse_enabled=sparse_enabled, sparse_themes=sparse_themes)
    compat_reason = sparse_compatibility_reason(preset, style_configs.get(preset, {}))
    
    perf_data = {}
    async def capture_perf(data):
        perf_data.update(data)
        
    async def prog(status, pct, msg):
        pass

    job_id = f"audit-60s-{preset}"
    error_stage = None
    final_output = None
    started = time.perf_counter()
    try:
        final_output = await export_headless(
            job_id=job_id,
            video_path=str(fixture_path),
            captions_json=captions_json,
            theme=preset,
            resolution="custom",
            progress_callback=prog,
            style_config_json=style_config_json,
            export_width=720,
            export_height=1280,
            export_fps=30,
            include_audio=True,
            quality="standard",
            export_mode="full_video",
            background_color="#000000",
            duration_override=60.0,
            performance_callback=capture_perf
        )
    except Exception as exc:
        error_stage = str(exc)

    wall_time = round(time.perf_counter() - started, 4)
    
    # Measure sparse plan counts
    sparse_plan_info = {}
    if engine.value == "browser_sparse":
        try:
            plan = build_sparse_caption_render_plan(captions, 30, preset, style_configs.get(preset, {}), 60.0)
            reasons_summary = {}
            for seg in plan:
                for r in seg.reason.split("+"):
                    reasons_summary[r] = reasons_summary.get(r, 0) + 1
            sparse_plan_info = {
                "word_count": sum(len(c.get("words", [])) for c in captions),
                "caption_count": len(captions),
                "entrance_animation_state_count": reasons_summary.get("caption_entrance", 0),
                "word_start_end_state_count": reasons_summary.get("word_start", 0) + reasons_summary.get("word_end", 0),
                "active_word_animation_state_count": reasons_summary.get("active_word_animation", 0),
                "reveal_state_count": reasons_summary.get("active_word_reveal", 0),
                "total_sparse_segments": len(plan),
                "unique_capture_frames": len(plan),
                "full_frame_count": 1800,
                "actual_reduction_percent": round((1 - len(plan)/1800) * 100, 2)
            }
        except Exception as e:
            sparse_plan_info["error"] = str(e)
            
    return {
        "preset": preset,
        "engine": engine.value,
        "sparseEnabled": sparse_enabled,
        "sparseCompatible": compat_reason is None,
        "fallbackReason": reason or compat_reason,
        "wallTime": wall_time,
        "output": final_output,
        "errorStage": error_stage,
        "perfSummary": perf_data,
        "sparsePlanMetrics": sparse_plan_info
    }

async def main():
    fixture = BACKEND_DIR / "temp" / "fixture_60s.mp4"
    print("Creating 60s fixture...", flush=True)
    create_60s_fixture(fixture)
    
    presets = ["minimal", "word_highlight_box", "whiteout_editorial"]
    results = {}
    for preset in presets:
        print(f"Running audit for preset: {preset}...", flush=True)
        results[preset] = await run_single_audit(preset, fixture)
        
    out_file = BACKEND_DIR / "temp" / "60s_audit_results.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\n--- AUDIT COMPLETE --- Saved to {out_file}")

if __name__ == "__main__":
    asyncio.run(main())
