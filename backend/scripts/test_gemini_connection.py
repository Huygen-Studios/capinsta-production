"""Sanitized Gemini connectivity diagnostic for the backend container."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ai_pipeline.transcriber import (  # noqa: E402
    GEMINI_INLINE_AUDIO_LIMIT_BYTES,
    GEMINI_TRANSCRIPTION_SCHEMA,
    _audio_mime_type,
    _classify_gemini_error,
    _extract_json_object,
    _gemini_api_key,
    _gemini_client,
    _gemini_transcription_prompt,
    _normalize_gemini_segments,
    _sanitize_provider_message,
    _validate_transcription_result,
)


def _model() -> str:
    return (os.getenv("GEMINI_TRANSCRIPTION_MODEL") or "gemini-3.5-flash").strip() or "gemini-3.5-flash"


def _print_result(kind: str, ok: bool, **fields: Any) -> None:
    payload = {"check": kind, "ok": ok, **fields}
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def _text_probe(client: Any, model: str) -> bool:
    try:
        interaction = client.interactions.create(
            model=model,
            input="Return exactly OK",
            timeout=60,
        )
        output = str(getattr(interaction, "output_text", "") or "").strip()
        if not output:
            _print_result("text", False, category="response_error", message="empty text response")
            return False
        _print_result("text", True, model=model, response_preview=output[:20])
        return True
    except Exception as exc:
        error = _classify_gemini_error(exc)
        _print_result(
            "text",
            False,
            category=error.category,
            status=error.status,
            google_code=error.provider_code,
            message=_sanitize_provider_message(str(error)),
        )
        return False


def _audio_input(client: Any, audio_path: Path) -> dict[str, Any]:
    mime_type = _audio_mime_type(str(audio_path))
    size_bytes = audio_path.stat().st_size
    if size_bytes < GEMINI_INLINE_AUDIO_LIMIT_BYTES:
        return {
            "type": "audio",
            "data": base64.b64encode(audio_path.read_bytes()).decode("utf-8"),
            "mime_type": mime_type,
        }
    uploaded_file = client.files.upload(file=str(audio_path), config={"mime_type": mime_type})
    return {
        "type": "audio",
        "uri": uploaded_file.uri,
        "mime_type": getattr(uploaded_file, "mime_type", None) or mime_type,
    }


def _audio_probe(client: Any, model: str, audio_path: Path) -> bool:
    try:
        interaction = client.interactions.create(
            model=model,
            input=[
                {"type": "text", "text": _gemini_transcription_prompt("auto_mixed_indian")},
                _audio_input(client, audio_path),
            ],
            response_format=GEMINI_TRANSCRIPTION_SCHEMA,
            timeout=180,
        )
        payload = _extract_json_object(str(getattr(interaction, "output_text", "") or ""))
        segments, words = _normalize_gemini_segments(payload)
        transcript = {
            "text": " ".join(str(segment.get("text") or "").strip() for segment in segments).strip(),
            "language": payload.get("language"),
            "segments": segments,
            "words": words,
            "provider": "gemini",
            "model": model,
        }
        _validate_transcription_result(transcript, "gemini", str(audio_path))
        _print_result(
            "audio",
            True,
            model=model,
            mime_type=_audio_mime_type(str(audio_path)),
            file_size=audio_path.stat().st_size,
            segment_count=len(segments),
            word_count=len(words),
        )
        return True
    except Exception as exc:
        if exc.__class__.__module__.startswith("google.genai"):
            error = _classify_gemini_error(exc)
            category = error.category
            status = error.status
            provider_code = error.provider_code
            message = str(error)
        else:
            category = "response_error"
            status = None
            provider_code = None
            message = str(exc)
        _print_result(
            "audio",
            False,
            category=category,
            status=status,
            google_code=provider_code,
            message=_sanitize_provider_message(message),
            mime_type=_audio_mime_type(str(audio_path)),
            file_size=audio_path.stat().st_size if audio_path.exists() else None,
        )
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Test Gemini auth/model access from the backend environment.")
    parser.add_argument("audio_path", nargs="?", help="Optional local audio file for transcription probe.")
    args = parser.parse_args()

    api_key = _gemini_api_key()
    if not api_key:
        _print_result("config", False, category="missing_key", message="GEMINI_API_KEY is missing or placeholder.")
        return 2

    model = _model()
    client = _gemini_client(api_key)
    ok = _text_probe(client, model)
    if args.audio_path:
        path = Path(args.audio_path)
        if not path.is_file():
            _print_result("audio", False, category="invalid_request", message="audio path does not exist")
            return 2
        ok = _audio_probe(client, model, path) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
