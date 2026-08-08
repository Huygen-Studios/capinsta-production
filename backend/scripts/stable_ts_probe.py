from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[1]


sys.path.insert(0, str(_backend_root()))

from ai_pipeline.sync.affine import validate_monotonic_word_timing  # noqa: E402
from ai_pipeline.sync.stable_refine import apply_stable_refinement  # noqa: E402
from ai_pipeline.timing import alignment_provider_status  # noqa: E402


def _cache_write_probe(path: str) -> tuple[bool, str | None]:
    try:
        os.makedirs(path, exist_ok=True)
        with tempfile.NamedTemporaryFile(prefix=".capinsta-stable-ts-probe-", dir=path, delete=True):
            pass
        return True, None
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def _simple_segments(transcript: str, duration: float) -> list[dict]:
    words = [word for word in transcript.split() if word]
    step = max(0.08, duration / max(1, len(words)))
    timed_words = []
    for index, word in enumerate(words):
        start = round(index * step, 3)
        timed_words.append({"word": word, "start": start, "end": round(min(duration, start + step * 0.75), 3)})
    return [{"text": transcript, "start": 0.0, "end": duration, "words": timed_words}]


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe stable-ts production readiness probe.")
    parser.add_argument("--audio", help="Optional 10-20 second speech audio file to align.")
    parser.add_argument("--transcript", help="Transcript text for --audio.")
    parser.add_argument("--language", default="english")
    parser.add_argument("--duration", type=float, default=15.0)
    parser.add_argument("--model", default=os.getenv("STABLE_TS_MODEL", "base"))
    parser.add_argument("--device", default=os.getenv("STABLE_TS_DEVICE", "auto"))
    args = parser.parse_args()

    status = alignment_provider_status()
    cache_dir = str(status.get("stableTsCacheDir") or os.getenv("STABLE_TS_CACHE_DIR") or "")
    cache_ok, cache_error = _cache_write_probe(cache_dir)
    result: dict[str, object] = {
        "stableTsImportable": status.get("stableTsImportable"),
        "stableTsVersion": status.get("stableTsVersion"),
        "torchAvailable": status.get("torchAvailable"),
        "torchVersion": status.get("torchVersion"),
        "torchCudaAvailable": status.get("torchCudaAvailable"),
        "ffmpegAvailable": status.get("ffmpegAvailable"),
        "ffprobeAvailable": status.get("ffprobeAvailable"),
        "ffmpegPath": shutil.which(os.getenv("FFMPEG_PATH") or "ffmpeg"),
        "configuredDevice": args.device,
        "cacheDir": cache_dir,
        "cacheWritable": cache_ok,
        "cacheWriteError": cache_error,
    }

    if args.audio:
        if not args.transcript:
            result.update(ok=False, category="missing_transcript", message="--transcript is required with --audio")
            print(json.dumps(result, sort_keys=True))
            return 2
        started = time.monotonic()
        segments = _simple_segments(args.transcript, args.duration)
        stable_result = apply_stable_refinement(
            segments,
            args.audio,
            args.language,
            config={
                "enabled": True,
                "model": args.model,
                "device": args.device,
                "minMatchCoverage": 0.5,
                "minWordRatio": 0.45,
                "maxWordRatio": 2.25,
                "allowOrderFallback": True,
            },
        )
        elapsed_ms = int((time.monotonic() - started) * 1000)
        words = [word for segment in stable_result.segments for word in segment.get("words") or []]
        monotonic = True
        try:
            validate_monotonic_word_timing(stable_result.segments)
        except Exception:
            monotonic = False
        result.update(
            alignmentApplied=stable_result.report.get("applied"),
            alignmentReason=stable_result.report.get("reason"),
            alignmentCategory=stable_result.report.get("errorCategory"),
            alignedWordCount=len(words),
            matchCoverage=stable_result.report.get("matchCoverage"),
            wordRatio=stable_result.report.get("wordRatio"),
            monotonic=monotonic,
            elapsedMs=elapsed_ms,
            firstWord=({"word": words[0].get("word"), "start": words[0].get("start"), "end": words[0].get("end")} if words else None),
            lastWord=({"word": words[-1].get("word"), "start": words[-1].get("start"), "end": words[-1].get("end")} if words else None),
        )
        ok = bool(stable_result.report.get("applied") and monotonic)
        result["ok"] = ok
        print(json.dumps(result, sort_keys=True))
        return 0 if ok else 1

    ok = bool(result["stableTsImportable"] and result["torchAvailable"] and result["ffmpegAvailable"] and cache_ok)
    result["ok"] = ok
    print(json.dumps(result, sort_keys=True))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
