from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_jobs.models import JobExecutionContext
from server.clipping_storage.models import ProbeSource

from .config import DurableTranscriptionConfig


class TranscriptionSourceCancelled(Exception):
    pass


def _download(
    source: ProbeSource,
    destination: Path,
    *,
    config: DurableTranscriptionConfig,
    stop: threading.Event,
) -> None:
    parsed = urlsplit(source.value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ProcessingJobFailure(
            "transcription_source_authorization_failed",
            "The private transcription source is not trusted HTTPS",
            retryable=False,
        )
    started = time.monotonic()
    try:
        with requests.get(
            source.value,
            stream=True,
            allow_redirects=False,
            timeout=(10, 5),
        ) as response:
            if response.status_code in {401, 403}:
                raise ProcessingJobFailure(
                    "transcription_source_authorization_failed",
                    "The private transcription source could not be authorized",
                    retryable=True,
                )
            if response.status_code >= 500:
                raise ProcessingJobFailure(
                    "transcription_source_unavailable",
                    "Private media storage is temporarily unavailable",
                    retryable=True,
                )
            if response.status_code != 200:
                raise ProcessingJobFailure(
                    "transcription_source_unavailable",
                    "The private transcription source is unavailable",
                    retryable=False,
                )
            declared = response.headers.get("content-length")
            if declared:
                try:
                    declared_size = int(declared)
                except ValueError:
                    declared_size = None
                if (
                    declared_size is not None
                    and declared_size > config.maximum_source_bytes
                ):
                    raise ProcessingJobFailure(
                        "transcription_source_too_large",
                        "The transcription audio exceeds its size limit",
                        retryable=False,
                    )
            total = 0
            with destination.open("wb") as output:
                for chunk in response.iter_content(256 * 1024):
                    if stop.is_set():
                        raise TranscriptionSourceCancelled
                    if (
                        time.monotonic() - started
                        > config.source_download_timeout_seconds
                    ):
                        raise ProcessingJobFailure(
                            "transcription_source_timeout",
                            "Downloading transcription audio timed out",
                            retryable=True,
                        )
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > config.maximum_source_bytes:
                        raise ProcessingJobFailure(
                            "transcription_source_too_large",
                            "The transcription audio exceeds its size limit",
                            retryable=False,
                        )
                    output.write(chunk)
            if total <= 0:
                raise ProcessingJobFailure(
                    "transcription_source_unavailable",
                    "The transcription audio is empty",
                    retryable=False,
                )
    except requests.RequestException as exc:
        raise ProcessingJobFailure(
            "transcription_source_unavailable",
            "Private media storage is temporarily unavailable",
            retryable=True,
        ) from exc


async def materialize_transcription_source(
    source: ProbeSource,
    *,
    context: JobExecutionContext,
    workspace: Path,
    config: DurableTranscriptionConfig,
) -> Path:
    if source.kind == "local_path":
        path = Path(source.value).resolve()
        if not path.is_file():
            raise ProcessingJobFailure(
                "transcription_source_unavailable",
                "The transcription audio is unavailable",
                retryable=True,
            )
        size = path.stat().st_size
        if size <= 0 or size > config.maximum_source_bytes:
            raise ProcessingJobFailure(
                "transcription_source_too_large",
                "The transcription audio exceeds its size limit",
                retryable=False,
            )
        destination = workspace / "audio.wav"
        with path.open("rb") as source_handle, destination.open("xb") as output:
            while True:
                if context.lease_lost_event.is_set():
                    raise JobOrchestrationError(
                        "job_lease_lost",
                        "The transcription source lease was lost"
                    )
                if (
                    context.shutdown_event.is_set()
                    or context.cancellation_event.is_set()
                    or await context.cancellation_callback()
                ):
                    raise asyncio.CancelledError
                chunk = source_handle.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
        if destination.stat().st_size != size:
            destination.unlink(missing_ok=True)
            raise ProcessingJobFailure(
                "transcription_source_unavailable",
                "The transcription audio could not be copied safely",
                retryable=True,
            )
        return destination

    destination = workspace / "audio.wav"
    stop = threading.Event()
    task = asyncio.create_task(
        asyncio.to_thread(
            _download,
            source,
            destination,
            config=config,
            stop=stop,
        )
    )
    try:
        while not task.done():
            if context.lease_lost_event.is_set():
                raise JobOrchestrationError(
                    "job_lease_lost",
                    "The transcription source lease was lost"
                )
            if (
                context.shutdown_event.is_set()
                or context.cancellation_event.is_set()
                or await context.cancellation_callback()
            ):
                raise asyncio.CancelledError
            await asyncio.wait({task}, timeout=0.2)
        return await task
    except BaseException:
        stop.set()
        try:
            await asyncio.wait_for(task, timeout=6)
        except BaseException:
            pass
        destination.unlink(missing_ok=True)
        raise


__all__ = [
    "TranscriptionSourceCancelled",
    "materialize_transcription_source",
]
