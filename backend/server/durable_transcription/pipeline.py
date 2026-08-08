from __future__ import annotations

import asyncio
import json
import multiprocessing
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from server.clipping_jobs.errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from server.clipping_jobs.models import JobExecutionContext


class TranscriptionPipeline(Protocol):
    async def transcribe(
        self,
        *,
        context: JobExecutionContext,
        audio_path: Path,
        language_mode: str,
        configuration_snapshot: dict[str, Any],
        timeout_seconds: int,
        maximum_response_bytes: int,
        workspace: Path,
    ) -> dict[str, Any]: ...


def _pipeline_process(
    audio_path: str,
    language_mode: str,
    configuration_snapshot: dict[str, Any],
    output_path: str,
) -> None:
    payload: dict[str, Any]
    try:
        from ai_pipeline.main import run_pipeline

        result = run_pipeline(
            audio_path,
            user_target_lang=language_mode,
            caption_output="original",
            transcription_config_snapshot=configuration_snapshot,
            pre_extracted_audio_path=audio_path,
        )
        payload = {"ok": True, "result": result}
    except BaseException as exc:
        code, retryable = _classify_pipeline_error(str(exc))
        payload = {
            "ok": False,
            "errorType": type(exc).__name__[:100],
            "errorCode": code,
            "retryable": retryable,
        }
    try:
        Path(output_path).write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    except BaseException:
        os._exit(2)


def _classify_pipeline_error(message: str) -> tuple[str, bool]:
    lowered = message.lower()
    if any(token in lowered for token in ("401", "403", "api key", "authentication")):
        return "transcription_provider_auth_failed", False
    if "rate" in lowered and "limit" in lowered or "429" in lowered:
        return "transcription_provider_rate_limited", True
    if "timeout" in lowered or "timed out" in lowered:
        return "transcription_provider_timeout", True
    if "unsupported" in lowered and "language" in lowered:
        return "transcription_provider_language_unsupported", False
    if "timestamp" in lowered or "word-level" in lowered:
        return "transcription_provider_word_timing_missing", False
    if "empty transcript" in lowered or "invalid response" in lowered:
        return "transcription_provider_response_invalid", False
    if any(token in lowered for token in ("connection", "temporarily unavailable", "503", "500")):
        return "transcription_provider_unavailable", True
    return "transcription_provider_internal_error", True


@dataclass
class ExistingTranscriptionPipeline:
    poll_seconds: float = 0.2
    terminate_grace_seconds: float = 3.0

    @staticmethod
    def _terminate(process: multiprocessing.Process) -> None:
        if not process.is_alive():
            process.join(timeout=0.1)
            return
        process.terminate()
        process.join(timeout=3)
        if process.is_alive() and hasattr(process, "kill"):
            process.kill()
            process.join(timeout=1)

    async def transcribe(
        self,
        *,
        context: JobExecutionContext,
        audio_path: Path,
        language_mode: str,
        configuration_snapshot: dict[str, Any],
        timeout_seconds: int,
        maximum_response_bytes: int,
        workspace: Path,
    ) -> dict[str, Any]:
        output_path = workspace / "pipeline-result.json"
        process = multiprocessing.get_context("spawn").Process(
            target=_pipeline_process,
            args=(
                str(audio_path),
                language_mode,
                configuration_snapshot,
                str(output_path),
            ),
            name=f"transcription-{context.job_id}",
            daemon=False,
        )
        started = time.monotonic()
        try:
            process.start()
        except (OSError, RuntimeError) as exc:
            raise ProcessingJobFailure(
                "transcription_provider_internal_error",
                "The transcription pipeline could not be started",
                retryable=True,
            ) from exc
        try:
            while process.is_alive():
                if context.lease_lost_event.is_set():
                    raise JobOrchestrationError(
                        "job_lease_lost",
                        "Transcription lost its processing-job lease",
                    )
                if (
                    context.shutdown_event.is_set()
                    or context.cancellation_event.is_set()
                    or await context.cancellation_callback()
                ):
                    raise asyncio.CancelledError
                if time.monotonic() - started >= timeout_seconds:
                    raise ProcessingJobFailure(
                        "transcription_provider_timeout",
                        "Transcription exceeded its hard timeout",
                        retryable=True,
                    )
                await asyncio.sleep(self.poll_seconds)
            await asyncio.to_thread(process.join, 0.1)
            if process.exitcode != 0 or not output_path.is_file():
                raise ProcessingJobFailure(
                    "transcription_provider_internal_error",
                    "The transcription pipeline exited without a valid response",
                    retryable=True,
                )
            size = output_path.stat().st_size
            if size <= 0 or size > maximum_response_bytes:
                raise ProcessingJobFailure(
                    "transcription_provider_response_invalid",
                    "The transcription response exceeded its safety limit",
                    retryable=False,
                )
            try:
                envelope = json.loads(
                    output_path.read_text(encoding="utf-8")
                )
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise ProcessingJobFailure(
                    "transcription_provider_response_invalid",
                    "The transcription pipeline returned malformed data",
                    retryable=False,
                ) from exc
            if not envelope.get("ok"):
                code = envelope.get("errorCode")
                if not isinstance(code, str) or not code.startswith(
                    "transcription_provider_"
                ):
                    code = "transcription_provider_internal_error"
                raise ProcessingJobFailure(
                    code,
                    "The transcription pipeline failed",
                    retryable=bool(envelope.get("retryable", True)),
                )
            result = envelope.get("result")
            if not isinstance(result, dict):
                raise ProcessingJobFailure(
                    "transcription_provider_response_invalid",
                    "The transcription pipeline returned an invalid response",
                    retryable=False,
                )
            if result.get("status") != "success":
                code, retryable = _classify_pipeline_error(
                    str(result.get("message") or "")
                )
                raise ProcessingJobFailure(
                    code,
                    "The configured transcription provider could not process the media",
                    retryable=retryable,
                )
            transcript = result.get("transcript")
            if not isinstance(transcript, dict):
                raise ProcessingJobFailure(
                    "transcription_provider_response_invalid",
                    "The transcription pipeline omitted its normalized transcript",
                    retryable=False,
                )
            return transcript
        except BaseException:
            await asyncio.to_thread(self._terminate, process)
            raise
        finally:
            if process.is_alive():
                await asyncio.to_thread(self._terminate, process)


__all__ = ["ExistingTranscriptionPipeline", "TranscriptionPipeline"]
