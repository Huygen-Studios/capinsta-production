from __future__ import annotations

import asyncio
import os
import re
import shutil
import signal
import subprocess
import time
from contextlib import suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

from server.clipping_jobs.errors import (
    JobOrchestrationError,
    ProcessingJobFailure,
)
from server.clipping_storage.models import ProbeSource

from .config import MediaProbeConfig

_SHOW_ENTRIES = (
    "format=format_name,format_long_name,duration,size,bit_rate:"
    "stream=index,codec_type,codec_name,codec_long_name,profile,width,height,"
    "coded_width,coded_height,pix_fmt,sample_rate,channels,channel_layout,"
    "duration,bit_rate,avg_frame_rate,r_frame_rate:"
    "stream_disposition=default,attached_pic:"
    "stream_tags=rotate:"
    "stream_side_data=rotation"
)
_URL = re.compile(r"https?://[^\s]+", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_NETWORK_FAILURE = re.compile(
    r"(timed?\s*out|connection\s+(?:reset|refused)|http\s+5\d\d|"
    r"server returned 5\d\d|temporary failure|network is unreachable)",
    re.IGNORECASE,
)


class MediaProbeCancelled(Exception):
    pass


class _OutputTooLarge(Exception):
    pass


async def _read_limited(
    stream: asyncio.StreamReader | None, maximum_bytes: int
) -> bytes:
    if stream is None:
        return b""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await stream.read(min(65_536, maximum_bytes + 1 - total))
        if not chunk:
            return b"".join(chunks)
        total += len(chunk)
        if total > maximum_bytes:
            raise _OutputTooLarge
        chunks.append(chunk)


def _safe_diagnostic(stderr: bytes, source: str) -> str:
    text = stderr.decode("utf-8", errors="replace")
    text = text.replace(source, "[private-source]")
    text = _URL.sub("[private-url]", text)
    text = _CONTROL.sub(" ", text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return (lines[-1] if lines else "FFprobe could not read the media")[:300]


class FFprobeRunner:
    def __init__(self, config: MediaProbeConfig) -> None:
        self.config = config
        self.executable = self._resolve_binary(config.ffprobe_binary)

    @staticmethod
    def _resolve_binary(value: str) -> str:
        candidate = Path(value)
        if candidate.is_absolute():
            if candidate.is_file():
                return str(candidate)
            return value
        return shutil.which(value) or value

    async def validate_available(self) -> str:
        try:
            process = await asyncio.create_subprocess_exec(
                self.executable,
                "-version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **self._process_group_options(),
            )
        except (FileNotFoundError, PermissionError, OSError) as exc:
            raise JobOrchestrationError(
                "worker_not_configured",
                "The enabled media-probe handler cannot execute FFprobe",
            ) from exc
        stdout_task = asyncio.create_task(_read_limited(process.stdout, 4096))
        stderr_task = asyncio.create_task(_read_limited(process.stderr, 4096))
        wait_task = asyncio.create_task(process.wait())
        try:
            stdout, _, _ = await asyncio.wait_for(
                asyncio.gather(stdout_task, stderr_task, wait_task),
                timeout=5,
            )
        except (TimeoutError, _OutputTooLarge) as exc:
            await self._terminate(process)
            raise JobOrchestrationError(
                "worker_not_configured",
                "FFprobe version validation failed its safety limits",
            ) from exc
        finally:
            for task in (stdout_task, stderr_task, wait_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(
                stdout_task,
                stderr_task,
                wait_task,
                return_exceptions=True,
            )
        if process.returncode != 0:
            raise JobOrchestrationError(
                "worker_not_configured",
                "FFprobe version validation failed",
            )
        first_line = stdout.decode("utf-8", errors="replace").splitlines()
        version = _CONTROL.sub("", first_line[0] if first_line else "")[:200]
        if not version.lower().startswith("ffprobe version"):
            raise JobOrchestrationError(
                "worker_not_configured",
                "Configured executable did not identify itself as FFprobe",
            )
        return version

    @staticmethod
    def _process_group_options() -> dict[str, object]:
        if os.name == "nt":
            return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        return {"start_new_session": True}

    async def _terminate(
        self, process: asyncio.subprocess.Process
    ) -> None:
        if process.returncode is not None:
            return
        try:
            if os.name != "nt" and process.pid:
                os.killpg(process.pid, signal.SIGTERM)
            else:
                process.terminate()
        except ProcessLookupError:
            return
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

    def _command(self, source: ProbeSource) -> tuple[str, ...]:
        protocols = "file" if source.kind == "local_path" else "https,tls,tcp"
        return (
            self.executable,
            "-v",
            "error",
            "-protocol_whitelist",
            protocols,
            "-probesize",
            str(self.config.probe_size_bytes),
            "-analyzeduration",
            str(self.config.analyze_duration_microseconds),
            "-show_entries",
            _SHOW_ENTRIES,
            "-of",
            "json",
            source.value,
        )

    def _effective_timeout(
        self, source: ProbeSource, job_timeout_seconds: int
    ) -> float:
        candidates = [
            float(self.config.timeout_seconds),
            float(job_timeout_seconds),
        ]
        if source.expires_at is not None:
            validity = (
                source.expires_at - datetime.now(timezone.utc)
            ).total_seconds() - self.config.signed_url_safety_seconds
            candidates.append(validity)
        timeout = min(candidates)
        if timeout <= 0:
            raise ProcessingJobFailure(
                "probe_source_unavailable",
                "The private probe source expires too soon",
                retryable=True,
            )
        return timeout

    async def run(
        self,
        source: ProbeSource,
        *,
        job_timeout_seconds: int,
        cancellation_check: Callable[[], Awaitable[bool]],
        cancellation_event: asyncio.Event,
        lease_lost_event: asyncio.Event,
        stop_event: asyncio.Event,
    ) -> bytes:
        timeout = self._effective_timeout(source, job_timeout_seconds)
        started = time.monotonic()
        try:
            process = await asyncio.create_subprocess_exec(
                *self._command(source),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **self._process_group_options(),
            )
        except FileNotFoundError as exc:
            raise ProcessingJobFailure(
                "ffprobe_not_installed",
                "FFprobe is not installed for the media worker",
                retryable=False,
            ) from exc
        except (PermissionError, OSError) as exc:
            raise ProcessingJobFailure(
                "ffprobe_start_failed",
                "FFprobe could not be started",
                retryable=True,
            ) from exc

        stdout_task = asyncio.create_task(
            _read_limited(process.stdout, self.config.maximum_stdout_bytes)
        )
        stderr_task = asyncio.create_task(
            _read_limited(process.stderr, self.config.maximum_stderr_bytes)
        )
        wait_task = asyncio.create_task(process.wait())
        tasks = (stdout_task, stderr_task, wait_task)
        try:
            while not wait_task.done():
                if lease_lost_event.is_set():
                    raise JobOrchestrationError(
                        "job_lease_lost",
                        "Media probe lost its processing-job lease",
                    )
                if cancellation_event.is_set() or await cancellation_check():
                    raise MediaProbeCancelled
                if stop_event.is_set():
                    raise asyncio.CancelledError
                if time.monotonic() - started >= timeout:
                    raise ProcessingJobFailure(
                        "ffprobe_timeout",
                        "Media probing exceeded its hard timeout",
                        retryable=True,
                    )
                for task in (stdout_task, stderr_task):
                    if task.done() and not task.cancelled() and isinstance(
                        task.exception(), _OutputTooLarge
                    ):
                        raise ProcessingJobFailure(
                            "ffprobe_output_too_large",
                            "FFprobe returned more output than allowed",
                            retryable=False,
                        )
                await asyncio.wait(tasks, timeout=0.5)
            try:
                stdout = await stdout_task
                stderr = await stderr_task
            except _OutputTooLarge as exc:
                raise ProcessingJobFailure(
                    "ffprobe_output_too_large",
                    "FFprobe returned more output than allowed",
                    retryable=False,
                ) from exc
            if process.returncode != 0:
                diagnostic = _safe_diagnostic(stderr, source.value)
                raise ProcessingJobFailure(
                    "ffprobe_nonzero_exit",
                    "FFprobe could not read the media",
                    retryable=(
                        source.kind == "ephemeral_url"
                        and bool(_NETWORK_FAILURE.search(diagnostic))
                    ),
                    details={
                        "exitCode": process.returncode,
                        "diagnostic": diagnostic,
                    },
                )
            return stdout
        except BaseException:
            await self._terminate(process)
            raise
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


__all__ = ["FFprobeRunner", "MediaProbeCancelled"]
