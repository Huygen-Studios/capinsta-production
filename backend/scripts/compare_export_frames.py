"""Extract and compare deterministic frames from two production MP4 exports."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


def extract_frame(video: Path, time_seconds: float, output: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{time_seconds:.9f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-vsync",
            "0",
            str(output),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def image_metrics(reference: Path, candidate: Path) -> dict[str, object]:
    with Image.open(reference).convert("RGB") as ref, Image.open(candidate).convert("RGB") as got:
        if ref.size != got.size:
            return {"dimensionsMatch": False, "referenceSize": ref.size, "candidateSize": got.size}
        difference = ImageChops.difference(ref, got)
        stat = ImageStat.Stat(difference)
        extrema = difference.getextrema()
        differing = sum(1 for pixel in difference.getdata() if pixel != (0, 0, 0))
        return {
            "dimensionsMatch": True,
            "size": ref.size,
            "meanAbsoluteChannelDifference": round(sum(stat.mean) / 3, 6),
            "maximumChannelDifference": max(channel[1] for channel in extrema),
            "differingPixelPercent": round(differing * 100 / (ref.width * ref.height), 6),
        }


def green_surface_metrics(path: Path) -> dict[str, object]:
    with Image.open(path).convert("RGB") as image:
        corners = {
            "topLeft": image.getpixel((0, 0)),
            "topRight": image.getpixel((image.width - 1, 0)),
            "bottomLeft": image.getpixel((0, image.height - 1)),
            "bottomRight": image.getpixel((image.width - 1, image.height - 1)),
        }
        green = (0, 255, 0)
        non_green = []
        for y in range(image.height):
            for x in range(image.width):
                pixel = image.getpixel((x, y))
                # H.264 chroma subsampling can shift pure green by a few levels.
                if not (pixel[1] >= 245 and pixel[0] <= 12 and pixel[2] <= 12):
                    non_green.append((x, y))
        bbox = None
        if non_green:
            xs, ys = zip(*non_green)
            bbox = [min(xs), min(ys), max(xs), max(ys)]
        return {
            "corners": corners,
            "allCornersGreen": all(g >= 245 and r <= 12 and b <= 12 for r, g, b in corners.values()),
            "anyCornerWhite": any(r >= 245 and g >= 245 and b >= 245 for r, g, b in corners.values()),
            "nonGreenPixelCount": len(non_green),
            "captionPixelsVisible": len(non_green) > 0,
            "nonGreenBoundingBox": bbox,
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--times", nargs="+", type=float, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--green-surface", action="store_true")
    args = parser.parse_args()

    report: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="capinsta_parity_") as temp:
        temp_path = Path(temp)
        for index, timestamp in enumerate(args.times):
            reference_png = temp_path / f"reference-{index:03d}.png"
            candidate_png = temp_path / f"candidate-{index:03d}.png"
            extract_frame(args.reference, timestamp, reference_png)
            extract_frame(args.candidate, timestamp, candidate_png)
            row = {"timeSeconds": timestamp, **image_metrics(reference_png, candidate_png)}
            if args.green_surface:
                row["candidateSurface"] = green_surface_metrics(candidate_png)
            report.append(row)

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
