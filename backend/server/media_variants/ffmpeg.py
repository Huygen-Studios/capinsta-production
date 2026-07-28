from __future__ import annotations

import asyncio
import os
import re
import shutil
import signal
import subprocess
import time
from collections import deque
from contextlib import suppress
from pathlib import Path
from typing import Awaitable, Callable

from server.clipping_jobs.errors import JobOrchestrationError, ProcessingJobFailure
from server.clipping_storage.models import ProbeSource

from .config import MediaVariantConfig

_URL = re.compile(r"https?://[^\s]+", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
ProgressCallback = Callable[[float], Awaitable[None]]


class FFmpegCancelled(Exception):
    pass


def parse_progress_time_us(fields: dict[str, str]) -> int | None:
    for key in ("out_time_us", "out_time_ms"):
        raw = fields.get(key)
        if raw is None:
            continue
        try:
            value = int(raw)
        except ValueError:
            continue
        if value >= 0:
            return value
    return None


def _diagnostic(data: bytes, source: str) -> str:
    text = data.decode("utf-8", errors="replace").replace(
        source, "[private-source]"
    )
    text = _URL.sub("[private-url]", text)
    text = _CONTROL.sub(" ", text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return (lines[-1] if lines else "FFmpeg processing failed")[:300]


class FFmpegRunner:
    def __init__(self, config: MediaVariantConfig) -> None:
        self.config = config
        self.executable = self._resolve(config.ffmpeg_binary)

    @staticmethod
    def _resolve(value: str) -> str:
        candidate = Path(value)
        if candidate.is_absolute():
            return str(candidate) if candidate.is_file() else value
        return shutil.which(value) or value

    @staticmethod
    def _process_group_options() -> dict[str, object]:
        if os.name == "nt":
            return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        return {"start_new_session": True}

    async def validate_available(self) -> str:
        try:
            process = await asyncio.create_subprocess_exec(
                self.executable,
                "-version",
                "-hide_banner",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **self._process_group_options(),
            )
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=5)
        except (FileNotFoundError, PermissionError, OSError, TimeoutError) as exc:
            raise JobOrchestrationError(
                "worker_not_configured",
                "The enabled media-variant handler cannot execute FFmpeg",
            ) from exc
        if process.returncode != 0:
            raise JobOrchestrationError(
                "worker_not_configured", "FFmpeg version validation failed"
            )
        line = stdout.decode("utf-8", errors="replace").splitlines()
        version = _CONTROL.sub("", line[0] if line else "")[:200]
        if not version.lower().startswith("ffmpeg version"):
            raise JobOrchestrationError(
                "worker_not_configured",
                "Configured executable did not identify itself as FFmpeg",
            )
        return version

    async def _terminate(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        with suppress(ProcessLookupError):
            if os.name != "nt" and process.pid:
                os.killpg(process.pid, signal.SIGTERM)
            else:
                process.terminate()
        try:
            await asyncio.wait_for(
                process.wait(), timeout=self.config.terminate_grace_seconds
            )
            return
        except TimeoutError:
            pass
        with suppress(ProcessLookupError):
            if os.name != "nt" and process.pid:
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        with suppress(Exception):
            await process.wait()

    async def run(
        self,
        source: ProbeSource,
        *,
        arguments: tuple[str, ...],
        duration_ms: int,
        timeout_seconds: int,
        job_timeout_seconds: int,
        cancellation_check: Callable[[], Awaitable[bool]],
        cancellation_event: asyncio.Event,
        lease_lost_event: asyncio.Event,
        stop_event: asyncio.Event,
        progress_callback: ProgressCallback,
    ) -> None:
        timeout = float(min(timeout_seconds, job_timeout_seconds))
        if source.expires_at is not None:
            from datetime import datetime, timezone

            timeout = min(
                timeout,
                (
                    source.expires_at - datetime.now(timezone.utc)
                ).total_seconds()
                - self.config.signed_url_safety_seconds,
            )
        if timeout <= 0:
            raise ProcessingJobFailure(
                "source_media_not_ready",
                "The private media source expires too soon",
                retryable=True,
            )
        command = (
            self.executable,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-protocol_whitelist",
            "file" if source.kind == "local_path" else "https,tls,tcp",
            "-i",
            source.value,
            "-progress",
            "pipe:1",
            "-nostats",
            *arguments,
        )
        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **self._process_group_options(),
            )
        except FileNotFoundError as exc:
            raise ProcessingJobFailure(
                "ffmpeg_not_installed",
                "FFmpeg is not installed for the media worker",
                retryable=False,
            ) from exc
        except (PermissionError, OSError) as exc:
            raise ProcessingJobFailure(
                "ffmpeg_start_failed",
                "FFmpeg could not be started",
                retryable=True,
            ) from exc

        stderr_parts: deque[bytes] = deque()
        stderr_total = 0

        async def read_stderr() -> None:
            nonlocal stderr_total
            assert process.stderr is not None
            while chunk := await process.stderr.read(8192):
                stderr_parts.append(chunk)
                stderr_total += len(chunk)
                while (
                    stderr_total > self.config.maximum_stderr_bytes
                    and stderr_parts
                ):
                    stderr_total -= len(stderr_parts.popleft())

        async def read_progress() -> None:
            assert process.stdout is not None
            fields: dict[str, str] = {}
            total = 0
            last_value = 5.0
            last_update = 0.0
            while line := await process.stdout.readline():
                total += len(line)
                if total > self.config.maximum_progress_bytes:
                    raise ProcessingJobFailure(
                        "ffmpeg_progress_invalid",
                        "FFmpeg progress exceeded its safety limit",
                        retryable=False,
                    )
                text = line.decode("ascii", errors="ignore").strip()
                if "=" not in text:
                    continue
                key, value = text.split("=", 1)
                if key == "progress":
                    out_time = parse_progress_time_us(fields)
                    if out_time is not None and duration_ms > 0:
                        raw = 5 + min(1.0, out_time / (duration_ms * 1000)) * 80
                        candidate = max(last_value, min(85.0, raw))
                        now = time.monotonic()
                        if candidate - last_value >= 2 or now - last_update >= 2:
                            await progress_callback(candidate)
                            last_value = candidate
                            last_update = now
                    fields.clear()
                elif len(key) <= 50 and len(value) <= 100:
                    fields[key] = value

        stderr_task = asyncio.create_task(read_stderr())
        progress_task = asyncio.create_task(read_progress())
        wait_task = asyncio.create_task(process.wait())
        started = time.monotonic()
        try:
            while not wait_task.done():
                if lease_lost_event.is_set():
                    raise JobOrchestrationError(
                        "job_lease_lost",
                        "Media variant lost its processing-job lease",
                    )
                if cancellation_event.is_set() or await cancellation_check():
                    raise FFmpegCancelled
                if stop_event.is_set():
                    raise asyncio.CancelledError
                if time.monotonic() - started >= timeout:
                    raise ProcessingJobFailure(
                        "ffmpeg_timeout",
                        "FFmpeg exceeded its hard timeout",
                        retryable=True,
                    )
                if progress_task.done() and progress_task.exception():
                    raise progress_task.exception()  # type: ignore[misc]
                await asyncio.wait(
                    (wait_task, stderr_task, progress_task), timeout=0.25
                )
            await asyncio.gather(stderr_task, progress_task)
            if process.returncode != 0:
                raise ProcessingJobFailure(
                    "ffmpeg_nonzero_exit",
                    "FFmpeg could not generate the media variant",
                    retryable=False,
                    details={
                        "exitCode": process.returncode,
                        "diagnostic": _diagnostic(
                            b"".join(stderr_parts), source.value
                        ),
                    },
                )
        except BaseException:
            await self._terminate(process)
            raise
        finally:
            for task in (stderr_task, progress_task, wait_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(
                stderr_task, progress_task, wait_task, return_exceptions=True
            )


__all__ = [
    "FFmpegCancelled",
    "FFmpegRunner",
    "parse_progress_time_us",
]
