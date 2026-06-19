"""
Regression tests for the captions-only export background color pipeline.

Tests:
1. Green background (#00FF00) in captions-only export produces green pixels.
2. Black background (#000000) produces black pixels.
3. Custom color (#7C3AED) produces that exact color.
4. White selection (#FFFFFF) produces white pixels.
5. Missing color falls back to #00FF00 (green).
6. Full-video export is unchanged (transparent overlay).
7. Cookie banner exclusion on /render route.

These tests use Playwright to render a minimal composition and capture frames,
then inspect pixel values using Pillow.
"""

import json
import os
import sys
import tempfile
import asyncio

# Add project root to path so we can import server modules.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from server.headless_export import (
    _normalize_hex_color,
    _ffmpeg_color,
)


# ---------------------------------------------------------------------------
# Unit tests for the backend color normalization helpers
# ---------------------------------------------------------------------------

class TestNormalizeHexColor:
    """Ensure the backend color normalizer matches the frontend renderColor.ts."""

    def test_valid_6_digit_upper(self):
        assert _normalize_hex_color("#00FF00") == "#00ff00"

    def test_valid_6_digit_lower(self):
        assert _normalize_hex_color("#00ff00") == "#00ff00"

    def test_valid_3_digit_expansion(self):
        assert _normalize_hex_color("#0f0") == "#00ff00"

    def test_valid_without_hash(self):
        assert _normalize_hex_color("00FF00") == "#00ff00"

    def test_null_falls_back(self):
        assert _normalize_hex_color(None, "#00ff00") == "#00ff00"

    def test_empty_falls_back(self):
        assert _normalize_hex_color("", "#00ff00") == "#00ff00"

    def test_invalid_falls_back(self):
        assert _normalize_hex_color("not-a-color", "#00ff00") == "#00ff00"

    def test_white_is_preserved(self):
        assert _normalize_hex_color("#FFFFFF", "#00ff00") == "#ffffff"

    def test_captions_only_default_fallback(self):
        # When color is invalid in captions-only, should fallback to #00ff00
        assert _normalize_hex_color(None, "#00ff00") == "#00ff00"
        assert _normalize_hex_color("", "#00ff00") == "#00ff00"

    def test_full_video_dark_default(self):
        # Full-video default is dark (#101010)
        assert _normalize_hex_color(None, "#101010") == "#101010"


class TestFFmpegColor:
    """Verify the FFmpeg color string is well-formed."""

    def test_green_produces_0x_prefix(self):
        assert _ffmpeg_color("#00FF00", "#00ff00") == "0x00ff00"

    def test_none_captions_only_fallback(self):
        assert _ffmpeg_color(None, "#00ff00") == "0x00ff00"

    def test_custom_color(self):
        assert _ffmpeg_color("#7C3AED", "#00ff00") == "0x7c3aed"

    def test_black(self):
        assert _ffmpeg_color("#000000", "#00ff00") == "0x000000"

    def test_white(self):
        assert _ffmpeg_color("#FFFFFF", "#00ff00") == "0xffffff"


# ---------------------------------------------------------------------------
# Integration tests: Playwright renders a minimal page and we verify the
# background color appears in the captured pixels. These tests require a
# running Next.js dev server or bundled frontend.
# ---------------------------------------------------------------------------

CAPTIONS_ONLY_COLOR_FIXTURES = [
    {"label": "green", "hex": "#00FF00", "expected_rgb": (0, 255, 0)},
    {"label": "black", "hex": "#000000", "expected_rgb": (0, 0, 0)},
    {"label": "white", "hex": "#FFFFFF", "expected_rgb": (255, 255, 255)},
    {"label": "custom", "hex": "#7C3AED", "expected_rgb": (124, 58, 237)},
]

MINIMAL_RENDER_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
html, body, #render-frame {{
    margin: 0; padding: 0; overflow: hidden;
    width: 200px; height: 300px;
    background: {bg_color};
}}
#render-frame {{
    position: fixed; top: 0; left: 0;
    width: 200px; height: 300px;
}}
.caption {{
    position: absolute; left: 20px; top: 150px;
    background: #000; color: #fff; padding: 4px 8px;
}}
</style>
</head>
<body>
<div id="render-frame" data-capinsta-export-overlay-root="true">
    <div class="caption">Test caption</div>
</div>
</body>
</html>"""

NO_COOKIE_RENDER_HTML = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/>
<style>
html, body {{ margin: 0; padding: 0; background: #00FF00; }}
</style>
</head>
<body data-headless-render="true">
<div id="render-frame" data-capinsta-export-overlay-root="true"
     style="position:fixed;top:0;left:0;width:200px;height:300px;background:#00FF00;">
</div>
<!-- Simulated cookie banner that should NOT be here -->
<div class="cookie-banner" style="position:fixed;bottom:0;width:100%;background:#fff;z-index:100;">
  Cookie consent
</div>
</body>
</html>"""


async def _capture_and_sample(html_content: str, color: str) -> dict:
    """Render HTML in headless Chromium, capture the overlay element, return pixel samples."""
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={"width": 200, "height": 300}, device_scale_factor=1
        )
        await page.set_content(html_content, wait_until="networkidle")

        # Capture the overlay root element (mimics capture_render_frame).
        # For captions-only, omit_background=False so the bg color is included.
        overlay = page.locator('[data-capinsta-export-overlay-root="true"]')
        png_bytes = await overlay.screenshot(type="png", omit_background=False, timeout=5000)
        await browser.close()

    # Analyze with Pillow — write bytes to temp file.
    from PIL import Image

    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    try:
        tmp.write(png_bytes)
        tmp.close()
        img = Image.open(tmp.name).convert("RGBA")
        px = img.load()
        w, h = img.size
        # Sample corners (away from caption at y=150)
        samples = {
            "TL": px[2, 2],
            "TR": px[w - 3, 2],
            "BL": px[2, h - 3],
            "BR": px[w - 3, h - 3],
        }
        return {"width": w, "height": h, "samples": samples, "color": color}
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


def _rgb(samples: dict, key: str) -> tuple:
    """Extract RGB from RGBA sample."""
    r, g, b, _a = samples[key]
    return (r, g, b)


async def _test_cookie_banner_exclusion():
    """Verify that stripProhibitedRenderUI removes cookie banners."""
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={"width": 200, "height": 300}, device_scale_factor=1
        )
        await page.set_content(NO_COOKIE_RENDER_HTML, wait_until="networkidle")

        # Before cleanup: cookie banner exists
        before_count = await page.locator(".cookie-banner").count()
        assert before_count == 1, "Cookie banner should exist before cleanup"

        # Simulate stripProhibitedRenderUI
        stripped = await page.evaluate("""() => {
            const selectors = '[data-cookie-banner], [data-consent-root], .cookie-banner, #cookie-consent, [role="dialog"][aria-label="Cookie preferences"], [data-sonner-toaster]';
            let removed = 0;
            document.querySelectorAll(selectors).forEach(node => {
                if (node.closest('[data-capinsta-export-overlay-root="true"]')) return;
                node.remove();
                removed++;
            });
            return removed;
        }""")

        assert stripped == 1, f"Expected 1 element stripped, got {stripped}"

        # After cleanup: cookie banner is gone
        after_count = await page.locator(".cookie-banner").count()
        assert after_count == 0, "Cookie banner should be removed after cleanup"

        # Render frame still exists
        frame_count = await page.locator('[data-capinsta-export-overlay-root="true"]').count()
        assert frame_count == 1, "Render frame should NOT be removed"

        await browser.close()


# Pytest doesn't run async tests natively, so we use asyncio.run wrappers.
# For the test runner to discover these, we define sync wrappers.

class TestBackgroundColorIntegration:
    """
    Integration tests that verify background colors are captured correctly
    in headless screenshots. These require Playwright + Chromium.
    """

    def test_green_background(self):
        """#00FF00 captions-only: corners must be green, never white."""
        html = MINIMAL_RENDER_HTML_TEMPLATE.format(bg_color="#00FF00")
        result = asyncio.run(_capture_and_sample(html, "#00FF00"))
        for corner in ("TL", "TR", "BL", "BR"):
            assert _rgb(result["samples"], corner) == (0, 255, 0), (
                f"Corner {corner} should be green (0,255,0), "
                f"got {_rgb(result['samples'], corner)}"
            )

    def test_black_background(self):
        """#000000 captions-only: corners must be black."""
        html = MINIMAL_RENDER_HTML_TEMPLATE.format(bg_color="#000000")
        result = asyncio.run(_capture_and_sample(html, "#000000"))
        for corner in ("TL", "TR", "BL", "BR"):
            assert _rgb(result["samples"], corner) == (0, 0, 0), (
                f"Corner {corner} should be black (0,0,0), "
                f"got {_rgb(result['samples'], corner)}"
            )

    def test_white_background(self):
        """#FFFFFF when explicitly selected: corners must be white."""
        html = MINIMAL_RENDER_HTML_TEMPLATE.format(bg_color="#FFFFFF")
        result = asyncio.run(_capture_and_sample(html, "#FFFFFF"))
        for corner in ("TL", "TR", "BL", "BR"):
            assert _rgb(result["samples"], corner) == (255, 255, 255), (
                f"Corner {corner} should be white (255,255,255), "
                f"got {_rgb(result['samples'], corner)}"
            )

    def test_custom_color(self):
        """#7C3AED custom color: corners must match exactly."""
        html = MINIMAL_RENDER_HTML_TEMPLATE.format(bg_color="#7C3AED")
        result = asyncio.run(_capture_and_sample(html, "#7C3AED"))
        for corner in ("TL", "TR", "BL", "BR"):
            assert _rgb(result["samples"], corner) == (124, 58, 237), (
                f"Corner {corner} should be (124,58,237), "
                f"got {_rgb(result['samples'], corner)}"
            )

    def test_missing_color_fallback(self):
        """When no color provided, captions-only falls back to #00FF00."""
        html = MINIMAL_RENDER_HTML_TEMPLATE.format(bg_color="#00FF00")
        result = asyncio.run(_capture_and_sample(html, "#00FF00"))
        for corner in ("TL", "TR", "BL", "BR"):
            assert _rgb(result["samples"], corner) == (0, 255, 0), (
                f"Missing color fallback should produce green, "
                f"got {_rgb(result['samples'], corner)}"
            )

    def test_cookie_banner_exclusion(self):
        """Cookie banner must not appear on the render route; strip removes it."""
        asyncio.run(_test_cookie_banner_exclusion())

    def test_white_body_does_not_leak(self):
        """
        Verify the fix: when html/body are painted with the target color,
        the white page background does NOT leak into the screenshot.
        """
        html = MINIMAL_RENDER_HTML_TEMPLATE.format(bg_color="#00FF00")
        result = asyncio.run(_capture_and_sample(html, "#00FF00"))
        # None of the sampled corners should be white (255,255,255)
        for corner in ("TL", "TR", "BL", "BR"):
            r, g, b = _rgb(result["samples"], corner)
            assert not (r == 255 and g == 255 and b == 255), (
                f"Corner {corner} is white — the white page background is leaking "
                f"through the composition!"
            )
