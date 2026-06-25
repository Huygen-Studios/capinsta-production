from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ai_pipeline.transcriber import (  # noqa: E402
    SARVAM_URL,
    STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS,
    _audio_duration_seconds,
    _sarvam_post_audio,
    _sarvam_response_result,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe Sarvam Saaras v3 word timestamp granularity safely.")
    parser.add_argument("audio_file", help="Path to an audio file mounted inside the backend container.")
    parser.add_argument("--language-code", default="en-IN", help="Sarvam language_code, for example en-IN, te-IN, hi-IN, or unknown.")
    parser.add_argument("--mode", default="transcribe", help="Sarvam mode, for example transcribe, verbatim, translit, or codemix.")
    parser.add_argument("--model", default="saaras:v3")
    parser.add_argument("--timeout", type=int, default=STT_PROVIDER_ATTEMPT_TIMEOUT_SECONDS)
    args = parser.parse_args()

    api_key = os.getenv("SARVAM_API_KEY", "").strip()
    if not api_key:
        print(json.dumps({"ok": False, "error": "SARVAM_API_KEY missing"}))
        return 2

    audio_path = Path(args.audio_file)
    if not audio_path.exists():
        print(json.dumps({"ok": False, "error": "audio file not found"}))
        return 2

    payload, latency_ms, _header_request_id, request_metadata = _sarvam_post_audio(
        str(audio_path),
        api_key=api_key,
        model=args.model,
        mode=args.mode,
        language_code=args.language_code,
        timeout_seconds=args.timeout,
    )
    result = _sarvam_response_result(
        payload,
        model=args.model,
        mode=args.mode,
        language_code=args.language_code,
        audio_duration=_audio_duration_seconds(str(audio_path)),
        latency_ms=latency_ms,
        request_metadata=request_metadata,
    )
    diagnostics = {
        **result.diagnostics,
        "endpoint": SARVAM_URL,
        "ok": result.granularity == "native_word",
        "sourcePath": result.source_path,
        "warnings": result.warnings,
    }
    print(json.dumps(diagnostics, ensure_ascii=False, sort_keys=True))
    return 0 if result.granularity == "native_word" else 1


if __name__ == "__main__":
    raise SystemExit(main())
