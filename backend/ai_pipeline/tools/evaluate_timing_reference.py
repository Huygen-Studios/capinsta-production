from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from ai_pipeline.pipeline_config import resolve_pipeline_config_with_sources
from ai_pipeline.tools.timing_reference_evaluator import (
    HARD_BOUNDARY_GUARD_SECONDS,
    compare_to_reference,
    flatten_pipeline_words,
    parse_srt,
    renderer_manifest_from_segments,
    write_markdown_report,
)

PROVIDER_SECRET_ENV = {
    "sarvam": "SARVAM_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "openai": "OPENAI_API_KEY",
    "openai_whisper": "OPENAI_API_KEY",
    "groq_whisper": "GROQ_API_KEY",
}


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _configured_provider_secrets_available() -> tuple[bool, list[str]]:
    configured = os.getenv("STT_PROVIDER_ORDER") or os.getenv("STT_PROVIDER") or "gemini,sarvam,openai_whisper"
    providers = [part.strip().lower() for part in configured.split(",") if part.strip()]
    missing: list[str] = []
    for provider in providers:
        secret_name = PROVIDER_SECRET_ENV.get(provider)
        if secret_name and os.getenv(secret_name):
            return True, missing
        if secret_name:
            missing.append(secret_name)
    return False, sorted(set(missing))


def _word_payload(word: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "spokenWord",
        "displayedWord",
        "word",
        "start",
        "end",
        "timingSource",
        "timing_source",
        "timingSourceDetail",
        "timingNeedsReview",
        "timingReviewRequired",
        "timingRepairReason",
        "alignmentGroupId",
        "sourceSegmentIndex",
        "sourceChunkIndex",
        "sourceStart",
        "sourceEnd",
        "nativeStart",
        "nativeEnd",
        "speakerId",
        "turnId",
        "captionBlockId",
        "segmentIndex",
        "wordIndex",
    )
    return {key: word.get(key) for key in keys if key in word and word.get(key) is not None}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate production caption timing against an SRT reference.")
    parser.add_argument("--input-video", required=True)
    parser.add_argument("--reference-srt", required=True)
    parser.add_argument("--language-mode", default="telgish")
    parser.add_argument("--caption-output", default="original")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(argv)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    resolved = resolve_pipeline_config_with_sources()
    _write_json(output_dir / "resolved_config.json", resolved)

    secrets_available, missing_secrets = _configured_provider_secrets_available()
    if not secrets_available:
        pause_split = ((resolved.get("resolved") or {}).get("captionChunking") or {}).get("pauseSplitThresholdSeconds")
        failure = {
            "passed": False,
            "failureCount": 1,
            "pauseSplitSeconds": pause_split,
            "hardBoundaryGuardSeconds": HARD_BOUNDARY_GUARD_SECONDS,
            "failures": [
                {
                    "type": "pipeline_preflight_failed",
                    "message": "No configured STT provider API secret is available in the local environment.",
                    "missingSecrets": missing_secrets,
                }
            ],
        }
        _write_json(output_dir / "pipeline_words.json", [])
        _write_json(output_dir / "renderer_timing_manifest.json", {"captionGroups": []})
        _write_json(output_dir / "reference_comparison.json", failure)
        write_markdown_report(output_dir / "reference_comparison.md", failure, resolved)
        return 2

    from ai_pipeline.main import run_pipeline

    result = run_pipeline(
        args.input_video,
        user_target_lang=args.language_mode,
        caption_output=args.caption_output,
    )
    if result.get("status") != "success":
        failure = {"passed": False, "failureCount": 1, "failures": [{"type": "pipeline_failed", "message": result.get("message")}]}
        _write_json(output_dir / "reference_comparison.json", failure)
        write_markdown_report(output_dir / "reference_comparison.md", failure, resolved)
        return 2

    segments = result.get("segments") or []
    transcript = result.get("transcript") or {"segments": segments}
    pipeline_words = [_word_payload(word) for word in flatten_pipeline_words(transcript)]
    renderer_manifest = renderer_manifest_from_segments(segments)
    cues = parse_srt(args.reference_srt)
    comparison = compare_to_reference(cues, pipeline_words, renderer_manifest, resolved)

    _write_json(output_dir / "pipeline_words.json", pipeline_words)
    _write_json(output_dir / "renderer_timing_manifest.json", renderer_manifest)
    _write_json(output_dir / "reference_comparison.json", comparison)
    write_markdown_report(output_dir / "reference_comparison.md", comparison, resolved)
    return 0 if comparison.get("passed") else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
