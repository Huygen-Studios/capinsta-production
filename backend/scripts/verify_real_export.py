"""
Real end-to-end verification of the captions-only export background fix.

This script:
1. Connects to the running Next.js dev server (or bundled static render page).
2. Loads /render.
3. Injects caption data via window.setCaptionData with backgroundColor=#00FF00,
   renderMode=captions_only, output size 1080x1920.
4. Waits for render readiness (document.documentElement.dataset.renderReady).
5. Captures a frame using the EXACT same logic as capture_render_frame in
   headless_export.py (omit_background=False for captions-only).
6. Runs the captured PNG through FFmpeg's overlay pipeline (matching the
   production captions-only FFmpeg command) to produce a real MP4.
7. Extracts the first frame from the MP4 with ffmpeg and inspects corner
   pixels to confirm they are green (not white).

Usage:
    set RENDER_PAGE_URL=http://localhost:3000/render
    backend\\venv\\Scripts\\python.exe backend\\tests\\verify_real_export.py
"""

import asyncio
import base64
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

RENDER_URL = os.getenv("RENDER_PAGE_URL", "http://localhost:3000/render")
WIDTH = 1080
HEIGHT = 1920
FPS = 24
DURATION_SEC = 1.0  # short for verification
BG_COLOR = "#00FF00"
OUT_DIR = Path(tempfile.mkdtemp(prefix="capinsta_verify_"))

# Minimal caption data: a single clip with one word, spanning the full duration.
CAPTIONS = [
    {
        "id": "clip-0",
        "trackId": "capinsta-export",
        "start": 0.0,
        "end": DURATION_SEC,
        "text": "Hello world",
        "words": [
            {"id": "word-0-0", "text": "Hello", "start": 0.0, "end": 0.5},
            {"id": "word-0-1", "text": "world", "start": 0.5, "end": DURATION_SEC},
        ],
    }
]


async def run_verification():
    from playwright.async_api import async_playwright

    print(f"[verify] render URL: {RENDER_URL}")
    print(f"[verify] output size: {WIDTH}x{HEIGHT}")
    print(f"[verify] background color: {BG_COLOR}")
    print(f"[verify] output dir: {OUT_DIR}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
            ],
        )
        page = await browser.new_page(
            viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1
        )

        logs = []
        page.on("console", lambda msg: (logs.append(msg.text), print(f"[page] {msg.text}")))
        page.on("pageerror", lambda exc: print(f"[pageerror] {exc}"))

        print(f"[verify] navigating to {RENDER_URL} ...")
        resp = await page.goto(RENDER_URL, wait_until="networkidle", timeout=60000)
        if resp is None or resp.status >= 400:
            print(f"[verify] FAILED to load render page: status={resp.status if resp else 'none'}")
            await browser.close()
            return False
        print(f"[verify] render page loaded (HTTP {resp.status})")

        await page.wait_for_function(
            "() => window.__CAPINSTA_RENDER_STATE__ && window.__CAPINSTA_RENDER_STATE__.version === 1",
            timeout=15000,
        )

        print("[verify] injecting caption data ...")
        inject_result = await page.evaluate(
            "([json, t, w, h, styleJson, fps, bg, compositionJson, renderMode, jobId, duration, audioIncluded]) => window.setCaptionData(json, t, w, h, styleJson, fps, bg, compositionJson, renderMode, jobId, duration, audioIncluded)",
            [
                json.dumps(CAPTIONS),
                "word_highlight_box",
                WIDTH,
                HEIGHT,
                "",
                FPS,
                BG_COLOR,
                "",  # no composition for captions-only
                "captions_only",
                "verify-job",
                DURATION_SEC,
                False,
            ],
        )
        print(f"[verify] setCaptionData result: {inject_result}")
        if isinstance(inject_result, dict) and not inject_result.get("ok"):
            print(f"[verify] FAILED: {inject_result}")
            await browser.close()
            return False

        print("[verify] waiting for render readiness ...")
        try:
            await page.wait_for_function(
                """() => {
                    const state = window.__CAPINSTA_RENDER_STATE__;
                    return state && (state.status === 'ready' || state.status === 'error');
                }""",
                timeout=20000,
            )
            render_state = await page.evaluate("() => window.__CAPINSTA_RENDER_STATE__ || null")
            if isinstance(render_state, dict) and render_state.get("status") == "error":
                print(f"[verify] FAILED: renderer error state {json.dumps(render_state, default=str)}")
                await browser.close()
                return False
            readiness = await page.evaluate(
                "() => (typeof window.getRenderReadiness === 'function' ? window.getRenderReadiness() : null)"
            )
            print(f"[verify] readiness: {json.dumps(readiness, default=str)}")
        except Exception as exc:
            print(f"[verify] readiness wait failed: {exc}")
            # Continue anyway — capture will tell us the truth.

        # Assert clean (no cookie banner).
        clean = await page.evaluate(
            "() => (typeof window.assertExportClean === 'function' ? window.assertExportClean() : { ok: true, debugOverlaysFound: 0 })"
        )
        print(f"[verify] assertExportClean: {json.dumps(clean, default=str)}")

        # Capture the frame using the SAME logic as capture_render_frame.
        overlay = page.locator('[data-capinsta-export-overlay-root="true"]')
        count = await overlay.count()
        print(f"[verify] overlay root count: {count}")

        # Advance to a frame where a caption is active.
        await page.evaluate("(frame) => window.setCaptionFrame(5)", 5)
        await page.wait_for_timeout(200)

        png_bytes = await overlay.screenshot(
            type="png", omit_background=False, timeout=15000
        )
        raw_frame = OUT_DIR / "frame_000000.png"
        raw_frame.write_bytes(png_bytes)
        print(f"[verify] captured raw caption PNG: {raw_frame} ({len(png_bytes)} bytes)")

        # Inspect raw PNG corners immediately.
        from PIL import Image
        img = Image.open(raw_frame).convert("RGBA")
        px = img.load()
        w, h = img.size
        print(f"[verify] raw PNG size: {w}x{h}")
        raw_corners = {
            "TL": px[2, 2],
            "TR": px[w - 3, 2],
            "BL": px[2, h - 3],
            "BR": px[w - 3, h - 3],
            "top-center": px[w // 2, 50],
            "mid-left": px[5, h // 2],
        }
        print(f"[verify] raw PNG corners: {raw_corners}")

        await browser.close()

    # --- Now run the REAL production FFmpeg captions-only pipeline ---
    total_frames = max(1, int(DURATION_SEC * FPS))
    mp4_path = OUT_DIR / f"verify_{WIDTH}x{HEIGHT}.mp4"
    safe_bg = "0x00ff00"

    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-r", str(FPS),
        "-i", f"color=c={safe_bg}:s={WIDTH}x{HEIGHT}:d={DURATION_SEC:.6f}",
        "-framerate", str(FPS), "-start_number", "0",
        "-i", str(OUT_DIR / "frame_%06d.png"),
        "-filter_complex",
        "[1:v]format=rgba[ov];[0:v][ov]overlay=0:0:format=auto:eof_action=pass:shortest=0[out]",
        "-map", "[out]",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-an",
        "-t", f"{DURATION_SEC:.6f}",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(mp4_path),
    ]
    print(f"[verify] running FFmpeg: {' '.join(ffmpeg_cmd)}")
    proc = await asyncio.create_subprocess_exec(
        *ffmpeg_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        print(f"[verify] FFmpeg FAILED (exit {proc.returncode}):")
        print(err.decode(errors="replace")[-2000:])
        return False
    print(f"[verify] FFmpeg produced MP4: {mp4_path} ({mp4_path.stat().st_size} bytes)")

    # --- Extract the first frame from the real MP4 ---
    first_frame = OUT_DIR / "extracted_frame_0001.png"
    extract_cmd = [
        "ffmpeg", "-y",
        "-i", str(mp4_path),
        "-frames:v", "1",
        str(first_frame),
    ]
    proc = await asyncio.create_subprocess_exec(
        *extract_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        print(f"[verify] frame extraction FAILED: {err.decode(errors='replace')[-1500:]}")
        return False
    print(f"[verify] extracted first frame: {first_frame}")

    # --- Inspect the extracted frame's pixels ---
    img = Image.open(first_frame).convert("RGB")
    px = img.load()
    w, h = img.size
    print(f"[verify] extracted frame size: {w}x{h}")
    corners = {
        "TL": px[2, 2],
        "TR": px[w - 3, 2],
        "BL": px[2, h - 3],
        "BR": px[w - 3, h - 3],
        "top-center": px[w // 2, 50],
        "mid-left": px[5, h // 2],
    }
    print(f"[verify] EXTRACTED FRAME corners: {corners}")

    # Verify: all corners must be green (or very close), never white.
    green = (0, 255, 0)
    white = (255, 255, 255)
    all_green = all(
        abs(c[0] - green[0]) <= 40 and abs(c[1] - green[1]) <= 40 and abs(c[2] - green[2]) <= 40
        for c in corners.values()
    )
    any_white = any(
        c[0] > 230 and c[1] > 230 and c[2] > 230 for c in corners.values()
    )

    print()
    print("=" * 60)
    print(f"[verify] all corners green: {all_green}")
    print(f"[verify] any corner white:  {any_white}")
    if all_green and not any_white:
        print("[verify] RESULT: PASS — background is green, no white leak")
        return True
    print("[verify] RESULT: FAIL — background is NOT green")
    return False


if __name__ == "__main__":
    success = asyncio.run(run_verification())
    sys.exit(0 if success else 1)
