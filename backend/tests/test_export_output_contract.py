import json
import os
import shutil
import subprocess
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from server.api.export_jobs import _validate_export_output_settings
from server.headless_export import (
    _ffmpeg_color,
    _normalize_hex_color,
    h264_nvenc_capability_available,
)


@pytest.mark.parametrize("dimensions", [(1920, 1080), (1080, 1920)])
def test_accepts_supported_1080p_dimensions(dimensions: tuple[int, int]) -> None:
    _validate_export_output_settings(*dimensions, 60)


@pytest.mark.parametrize("dimensions", [(3840, 2160), (2160, 3840)])
def test_rejects_4k_dimensions(dimensions: tuple[int, int]) -> None:
    with pytest.raises(HTTPException) as error:
        _validate_export_output_settings(*dimensions, 30)
    assert error.value.status_code == 400


def test_rejects_frame_rates_above_60() -> None:
    with pytest.raises(HTTPException) as error:
        _validate_export_output_settings(1920, 1080, 61)
    assert error.value.status_code == 400


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("#00FF00", "#00ff00"),
        ("#000000", "#000000"),
        ("#FFFFFF", "#ffffff"),
        ("123456", "#123456"),
    ],
)
def test_backend_normalizes_export_background(value: str, expected: str) -> None:
    assert _normalize_hex_color(value, "#00ff00") == expected


def _require_ffmpeg() -> tuple[str, str]:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        pytest.skip("FFmpeg and FFprobe are required for encoded export tests.")
    return ffmpeg, ffprobe


def test_encoded_green_background_and_60_fps(tmp_path) -> None:
    ffmpeg, ffprobe = _require_ffmpeg()
    output = tmp_path / "green-60.mp4"
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c={_ffmpeg_color('#00FF00')}:s=64x64:r=60:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
            str(output),
        ],
        check=True,
    )

    pixel = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(output),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        check=True,
        capture_output=True,
    ).stdout[:3]
    red, green, blue = pixel
    assert green > 220
    assert red < 40
    assert blue < 40

    probe = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=r_frame_rate,avg_frame_rate,nb_frames,width,height",
            "-of",
            "json",
            str(output),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    assert stream["r_frame_rate"] == "60/1"
    assert stream["avg_frame_rate"] == "60/1"
    assert stream["width"] == 64
    assert stream["height"] == 64
    assert 59 <= int(stream["nb_frames"]) <= 61


def test_hardware_encoder_probe_returns_a_capability_result() -> None:
    assert isinstance(h264_nvenc_capability_available(), bool)
