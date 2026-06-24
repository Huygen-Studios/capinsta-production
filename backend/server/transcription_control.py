from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from .settings import DB_PATH
from .transcription_catalog import catalog_entry, validate_catalog_selection
from ai_pipeline.pipeline_config import DEFAULT_PIPELINE_OPTIONS, resolve_pipeline_config

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    psycopg = None
    dict_row = None


@dataclass(frozen=True)
class TranscriptionConfigSnapshot:
    configuration_id: str
    provider: str
    model: str
    version: int
    provider_options: dict[str, Any]
    timestamp_strategy: str
    strict_provider: bool = True
    source_language: str | None = None
    output_language: str | None = None
    resolved_provider_mode: str | None = None
    resolved_provider_language_code: str | None = None
    pipeline_options: dict[str, Any] | None = None
    resolved_pipeline_options: dict[str, Any] | None = None

    @property
    def provider_mode(self) -> str:
        return str(self.resolved_provider_mode or self.provider_options.get("mode") or "transcribe")

    @property
    def provider_language_code(self) -> str | None:
        value = self.resolved_provider_language_code or self.provider_options.get("language_code") or self.provider_options.get("languageCode")
        return str(value) if value else None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        pipeline_options = self.pipeline_options or DEFAULT_PIPELINE_OPTIONS
        resolved_pipeline_options = self.resolved_pipeline_options or resolve_pipeline_config(pipeline_options).to_dict()
        payload["pipeline_options"] = pipeline_options
        payload["resolved_pipeline_options"] = resolved_pipeline_options
        payload["provider_mode"] = self.provider_mode
        payload["provider_language_code"] = self.provider_language_code
        return payload


_CACHE: tuple[float, TranscriptionConfigSnapshot | None] = (0.0, None)
_CACHE_TTL_SECONDS = 15.0
_CIRCUITS: dict[tuple[str, str, int], dict[str, Any]] = {}
_PLACEHOLDER_SECRET_TOKENS = (
    "placeholder",
    "your_api_key",
    "your api key",
    "your_",
    "real key",
    "remove it",
    "example",
    "changeme",
)


def _database_url() -> str:
    return (os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()


def _production_mode() -> bool:
    return (os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "").lower() in {"production", "prod"}


def _real_env_secret(name: str) -> bool:
    cleaned = (os.getenv(name) or "").strip()
    if not cleaned:
        return False
    lowered = cleaned.lower()
    if cleaned.startswith("<") and cleaned.endswith(">"):
        return False
    if set(cleaned) <= {"."}:
        return False
    return not any(token in lowered for token in _PLACEHOLDER_SECRET_TOKENS)


def _auto_env_provider() -> tuple[str, str] | None:
    if _real_env_secret("SARVAM_API_KEY"):
        return "sarvam", "saaras:v3"
    if _real_env_secret("GEMINI_API_KEY") or _real_env_secret("GOOGLE_API_KEY"):
        return "gemini", os.getenv("GEMINI_TRANSCRIPTION_MODEL", "gemini-3.5-flash").strip() or "gemini-3.5-flash"
    if _real_env_secret("OPENAI_API_KEY"):
        return "openai", os.getenv("OPENAI_TRANSCRIPTION_MODEL", "whisper-1").strip() or "whisper-1"
    return None


def _env_snapshot() -> TranscriptionConfigSnapshot | None:
    provider = (os.getenv("STT_PROVIDER") or "").strip().lower().replace("-", "_")
    if provider in {"", "auto"}:
        selected = _auto_env_provider()
        if selected is None:
            return None
        provider, model = selected
    else:
        model = ""
    if provider in {"openai_whisper", "openai"}:
        provider = "openai"
        model = model or os.getenv("OPENAI_TRANSCRIPTION_MODEL", "whisper-1").strip() or "whisper-1"
    elif provider == "gemini":
        model = model or os.getenv("GEMINI_TRANSCRIPTION_MODEL", "gemini-3.5-flash").strip() or "gemini-3.5-flash"
    elif provider == "sarvam":
        model = model or "saaras:v3"
    else:
        return None
    entry = catalog_entry(provider, model)
    if entry is None:
        return None
    options = {"mode": "transcribe", "languageStrategy": "language_mode_mapping"} if provider == "sarvam" else {}
    return TranscriptionConfigSnapshot(
        configuration_id="env-bootstrap",
        provider=provider,
        model=model,
        version=0,
        provider_options=options,
        timestamp_strategy=entry.timestamp_strategy,
        strict_provider=True,
        pipeline_options=DEFAULT_PIPELINE_OPTIONS,
        resolved_pipeline_options=DEFAULT_PIPELINE_OPTIONS,
    )


def invalidate_transcription_config_cache() -> None:
    global _CACHE
    _CACHE = (0.0, None)


def _snapshot_from_row(row: dict[str, Any]) -> TranscriptionConfigSnapshot:
    provider_options = row.get("provider_options") or {}
    if isinstance(provider_options, str):
        provider_options = json.loads(provider_options or "{}")
    pipeline_options = row.get("pipeline_options") or {}
    if isinstance(pipeline_options, str):
        pipeline_options = json.loads(pipeline_options or "{}")
    resolved_pipeline_options = resolve_pipeline_config(pipeline_options).to_dict()
    validate_catalog_selection(
        str(row["provider"]),
        str(row["model"]),
        str(row["timestamp_strategy"]),
        provider_options,
    )
    return TranscriptionConfigSnapshot(
        configuration_id=str(row["id"]),
        provider=str(row["provider"]),
        model=str(row["model"]),
        version=int(row["version"]),
        provider_options=dict(provider_options),
        timestamp_strategy=str(row["timestamp_strategy"]),
        strict_provider=bool(row.get("strict_provider", True)),
        pipeline_options=resolved_pipeline_options,
        resolved_pipeline_options=resolved_pipeline_options,
    )


def active_transcription_config() -> TranscriptionConfigSnapshot | None:
    global _CACHE
    now = time.monotonic()
    if now - _CACHE[0] < _CACHE_TTL_SECONDS:
        return _CACHE[1]

    database_url = _database_url()
    if database_url and psycopg is not None:
        try:
            try:
                row = _active_config_row(database_url, include_pipeline_options=True)
            except Exception as exc:
                if "pipeline_options" not in str(exc):
                    raise
                row = _active_config_row(database_url, include_pipeline_options=False)
            snapshot = _snapshot_from_row(row) if row else _env_snapshot()
            _CACHE = (now, snapshot)
            return snapshot
        except Exception:
            snapshot = _env_snapshot()
            if _production_mode() and snapshot is None:
                _CACHE = (now, None)
                return None
            if snapshot is not None:
                _CACHE = (now, snapshot)
                return snapshot

    snapshot = _env_snapshot()
    _CACHE = (now, snapshot)
    return snapshot


def _active_config_row(database_url: str, *, include_pipeline_options: bool) -> dict[str, Any] | None:
    pipeline_select = ", pipeline_options" if include_pipeline_options else ""
    with psycopg.connect(database_url, row_factory=dict_row, connect_timeout=4) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT id, provider, model, provider_options, timestamp_strategy,
                       strict_provider, version{pipeline_select}
                FROM transcription_configurations
                WHERE status = 'active'
                LIMIT 1
                """
            )
            return cursor.fetchone()


def _circuit_key(snapshot: TranscriptionConfigSnapshot) -> tuple[str, str, int]:
    return (snapshot.provider, snapshot.model, snapshot.version)


def circuit_state(snapshot: TranscriptionConfigSnapshot) -> dict[str, Any]:
    state = _CIRCUITS.get(_circuit_key(snapshot))
    if not state:
        return {"status": "healthy", "open": False}
    opened_until = float(state.get("opened_until") or 0)
    if opened_until and opened_until > time.monotonic():
        return {
            "status": "degraded",
            "open": True,
            "failureCount": int(state.get("failures") or 0),
            "retryAfterSeconds": max(1, int(opened_until - time.monotonic())),
        }
    return {"status": "healthy", "open": False, "failureCount": int(state.get("failures") or 0)}


def assert_transcription_available() -> TranscriptionConfigSnapshot:
    snapshot = active_transcription_config()
    if snapshot is None:
        raise HTTPException(
            status_code=503,
            detail="Caption generation is temporarily unavailable. Your upload is safe. Please retry shortly.",
        )
    if circuit_state(snapshot).get("open"):
        raise HTTPException(
            status_code=503,
            detail="Caption generation is temporarily unavailable. Your upload is safe. Please retry shortly.",
        )
    return snapshot


def record_provider_success(snapshot: TranscriptionConfigSnapshot | dict[str, Any] | None) -> None:
    parsed = coerce_snapshot(snapshot)
    if not parsed:
        return
    _CIRCUITS.pop(_circuit_key(parsed), None)


def record_provider_failure(snapshot: TranscriptionConfigSnapshot | dict[str, Any] | None, *, retryable: bool) -> None:
    parsed = coerce_snapshot(snapshot)
    if not parsed or not retryable:
        return
    key = _circuit_key(parsed)
    state = _CIRCUITS.setdefault(key, {"failures": 0, "opened_until": 0})
    state["failures"] = int(state.get("failures") or 0) + 1
    threshold = max(1, int(os.getenv("TRANSCRIPTION_CIRCUIT_FAILURE_THRESHOLD", "3")))
    if state["failures"] >= threshold:
        cooldown = max(10, int(os.getenv("TRANSCRIPTION_CIRCUIT_COOLDOWN_SECONDS", "120")))
        state["opened_until"] = time.monotonic() + cooldown


def coerce_snapshot(value: TranscriptionConfigSnapshot | dict[str, Any] | str | None) -> TranscriptionConfigSnapshot | None:
    if value is None:
        return None
    if isinstance(value, TranscriptionConfigSnapshot):
        return value
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    try:
        provider_options = value.get("provider_options") or value.get("providerOptions") or {}
        pipeline_options = resolve_pipeline_config(
            value.get("resolved_pipeline_options")
            or value.get("resolvedPipelineOptions")
            or value.get("pipeline_options")
            or value.get("pipelineOptions")
            or {}
        ).to_dict()
        return TranscriptionConfigSnapshot(
            configuration_id=str(value.get("configuration_id") or value.get("configurationId") or "unknown"),
            provider=str(value["provider"]),
            model=str(value["model"]),
            version=int(value.get("version") or value.get("configuration_version") or 0),
            provider_options=dict(provider_options),
            timestamp_strategy=str(value["timestamp_strategy"] if "timestamp_strategy" in value else value["timestampStrategy"]),
            strict_provider=bool(value.get("strict_provider", value.get("strictProvider", True))),
            source_language=value.get("source_language") or value.get("sourceLanguage"),
            output_language=value.get("output_language") or value.get("outputLanguage"),
            resolved_provider_mode=(
                value.get("resolved_provider_mode")
                or value.get("provider_mode")
                or value.get("providerMode")
            ),
            resolved_provider_language_code=(
                value.get("resolved_provider_language_code")
                or value.get("provider_language_code")
                or value.get("providerLanguageCode")
            ),
            pipeline_options=pipeline_options,
            resolved_pipeline_options=pipeline_options,
        )
    except Exception:
        return None


def persist_snapshot_to_runtime_db(job_id: str, snapshot: TranscriptionConfigSnapshot) -> None:
    payload = snapshot.to_dict()
    with sqlite3.connect(str(DB_PATH)) as connection:
        connection.execute(
            """
            UPDATE jobs
            SET transcription_provider = ?,
                transcription_model = ?,
                transcription_config_version = ?,
                timestamp_strategy = ?,
                provider_mode = ?,
                pipeline_options_json = ?,
                transcription_config_snapshot_json = ?
            WHERE id = ?
            """,
            (
                snapshot.provider,
                snapshot.model,
                snapshot.version,
                snapshot.timestamp_strategy,
                snapshot.provider_mode,
                json.dumps(snapshot.resolved_pipeline_options or DEFAULT_PIPELINE_OPTIONS, ensure_ascii=False),
                json.dumps(payload, ensure_ascii=False),
                job_id,
            ),
        )
        connection.commit()


def bundled_test_audio_path() -> str:
    fixture = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "transcription-test.wav"
    if fixture.exists():
        return str(fixture)
    generated = Path(os.getenv("CAPINSTA_TEST_AUDIO_PATH", "")) if os.getenv("CAPINSTA_TEST_AUDIO_PATH") else None
    if generated and generated.exists():
        return str(generated)
    raise FileNotFoundError("transcription_test_audio_missing")
