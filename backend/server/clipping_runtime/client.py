from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import subprocess
import threading
from contextlib import suppress
from pathlib import Path
from typing import Any, Awaitable, Callable

from pydantic import ValidationError

from .config import ClippingRuntimeConfig
from .contracts import (
    ConversionRuntimeResultV1,
    DerivationRuntimeResultV1,
    RuntimeHealthResultV1,
    RuntimeResponseV1,
    RuntimeVersionResultV1,
)
from .errors import ClippingRuntimeError

CancellationCheck = Callable[[], Awaitable[bool]]


async def _never() -> bool:
    return False


class ClippingRuntimeClient:
    def __init__(self, config: ClippingRuntimeConfig) -> None:
        self.config = config

    def resolve_binary(self) -> str:
        configured = self.config.binary
        if not configured:
            raise ClippingRuntimeError(
                "clipping_runtime_missing", "The clipping runtime is not configured."
            )
        resolved = shutil.which(configured)
        if resolved is None and Path(configured).is_file():
            resolved = str(Path(configured).resolve())
        if resolved is None:
            raise ClippingRuntimeError(
                "clipping_runtime_missing",
                "The clipping runtime executable is unavailable.",
                retryable=True,
            )
        if os.name != "nt" and not os.access(resolved, os.X_OK):
            raise ClippingRuntimeError(
                "clipping_runtime_start_failed",
                "The clipping runtime executable cannot be started.",
                retryable=True,
            )
        return resolved

    async def _read_bounded(
        self, stream: asyncio.StreamReader, maximum: int, code: str
    ) -> bytes:
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = await stream.read(min(65_536, maximum + 1 - total))
            if not chunk:
                return b"".join(chunks)
            total += len(chunk)
            if total > maximum:
                raise ClippingRuntimeError(
                    code, "The clipping runtime produced excessive output."
                )
            chunks.append(chunk)

    async def _terminate(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        try:
            if os.name == "nt":
                process.terminate()
            else:
                os.killpg(process.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            await asyncio.wait_for(
                process.wait(), timeout=self.config.terminate_grace_seconds
            )
            return
        except asyncio.TimeoutError:
            pass
        with suppress(ProcessLookupError, PermissionError):
            if os.name == "nt":
                process.kill()
            else:
                os.killpg(process.pid, signal.SIGKILL)
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(
                process.wait(), timeout=self.config.terminate_grace_seconds
            )

    async def _invoke_native(
        self,
        *,
        operation: str,
        payload: dict[str, Any],
        request_id: str,
        timeout_seconds: int | None = None,
        cancellation_check: CancellationCheck = _never,
        cancellation_event: asyncio.Event | None = None,
        lease_lost_event: asyncio.Event | None = None,
        shutdown_event: asyncio.Event | None = None,
    ) -> tuple[dict[str, Any], tuple[str, ...]]:
        request = {
            "protocolVersion": self.config.protocol_version,
            "requestId": request_id,
            "operation": operation,
            "payload": payload,
            "options": {},
        }
        encoded = json.dumps(
            request, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        if len(encoded) > self.config.maximum_stdin_bytes:
            raise ClippingRuntimeError(
                "clipping_runtime_input_too_large",
                "The clipping runtime request exceeds its configured limit.",
            )
        kwargs: dict[str, Any] = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        try:
            process = await asyncio.create_subprocess_exec(
                self.resolve_binary(),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **kwargs,
            )
        except (OSError, ValueError) as exc:
            raise ClippingRuntimeError(
                "clipping_runtime_start_failed",
                "The clipping runtime could not be started.",
                retryable=True,
            ) from exc
        assert process.stdin and process.stdout and process.stderr
        stdout_task = asyncio.create_task(
            self._read_bounded(
                process.stdout,
                self.config.maximum_stdout_bytes,
                "clipping_runtime_output_too_large",
            )
        )
        stderr_task = asyncio.create_task(
            self._read_bounded(
                process.stderr,
                self.config.maximum_stderr_bytes,
                "clipping_runtime_stderr_too_large",
            )
        )
        wait_task = asyncio.create_task(process.wait())
        started = asyncio.get_running_loop().time()
        effective_timeout = min(
            timeout_seconds or self.config.timeout_seconds,
            self.config.timeout_seconds,
        )
        try:
            process.stdin.write(encoded)
            await process.stdin.drain()
            process.stdin.close()
            with suppress(Exception):
                await process.stdin.wait_closed()
            while not wait_task.done():
                if lease_lost_event and lease_lost_event.is_set():
                    raise ClippingRuntimeError(
                        "clipping_runtime_lease_lost",
                        "The clipping runtime invocation lost its job lease.",
                    )
                if (
                    (shutdown_event and shutdown_event.is_set())
                    or (cancellation_event and cancellation_event.is_set())
                    or await cancellation_check()
                ):
                    raise ClippingRuntimeError(
                        "clipping_runtime_cancelled",
                        "The clipping runtime invocation was cancelled.",
                    )
                if asyncio.get_running_loop().time() - started >= effective_timeout:
                    raise ClippingRuntimeError(
                        "clipping_runtime_timeout",
                        "The clipping runtime exceeded its hard timeout.",
                        retryable=True,
                    )
                if stdout_task.done() and stdout_task.exception():
                    raise stdout_task.exception()
                if stderr_task.done() and stderr_task.exception():
                    raise stderr_task.exception()
                await asyncio.sleep(0.05)
            stdout, _stderr = await asyncio.gather(stdout_task, stderr_task)
        except BaseException:
            await self._terminate(process)
            raise
        finally:
            for task in (stdout_task, stderr_task, wait_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(
                stdout_task, stderr_task, wait_task, return_exceptions=True
            )
            # CPython's Windows Proactor can otherwise defer pipe-transport
            # cleanup until after the isolated event loop has closed.
            if os.name == "nt":
                transport = getattr(process, "_transport", None)
                if transport is not None:
                    transport.close()
                await asyncio.sleep(0)
        try:
            decoded = json.loads(stdout.decode("utf-8"))
            response = RuntimeResponseV1.model_validate(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as exc:
            raise ClippingRuntimeError(
                "clipping_runtime_invalid_response",
                "The clipping runtime returned an invalid response.",
            ) from exc
        if response.requestId != request_id:
            raise ClippingRuntimeError(
                "clipping_runtime_request_mismatch",
                "The clipping runtime response did not match its request.",
            )
        if response.protocolVersion != self.config.protocol_version:
            raise ClippingRuntimeError(
                "clipping_runtime_incompatible",
                "The clipping runtime protocol is incompatible.",
            )
        if not response.ok:
            assert response.error is not None
            raise ClippingRuntimeError(
                response.error.code,
                response.error.message,
                retryable=False,
            )
        if process.returncode != 0:
            raise ClippingRuntimeError(
                "clipping_runtime_invalid_response",
                "The clipping runtime exited unsuccessfully.",
            )
        assert response.result is not None
        return response.result, tuple(sorted(set(response.warnings)))

    async def invoke(
        self,
        *,
        operation: str,
        payload: dict[str, Any],
        request_id: str,
        timeout_seconds: int | None = None,
        cancellation_check: CancellationCheck = _never,
        cancellation_event: asyncio.Event | None = None,
        lease_lost_event: asyncio.Event | None = None,
        shutdown_event: asyncio.Event | None = None,
    ) -> tuple[dict[str, Any], tuple[str, ...]]:
        loop = asyncio.get_running_loop()
        if os.name != "nt" or not isinstance(loop, asyncio.SelectorEventLoop):
            return await self._invoke_native(
                operation=operation,
                payload=payload,
                request_id=request_id,
                timeout_seconds=timeout_seconds,
                cancellation_check=cancellation_check,
                cancellation_event=cancellation_event,
                lease_lost_event=lease_lost_event,
                shutdown_event=shutdown_event,
            )

        # Psycopg requires a Selector loop on Windows, while asyncio subprocess
        # transports require a Proactor loop. Keep DB callbacks on the worker
        # loop and run only the isolated subprocess transport on a helper loop.
        cancelled = threading.Event()
        lease_lost = threading.Event()

        def run_on_proactor():
            async def cancelled_check() -> bool:
                return cancelled.is_set()

            async def run():
                result = await self._invoke_native(
                    operation=operation,
                    payload=payload,
                    request_id=request_id,
                    timeout_seconds=timeout_seconds,
                    cancellation_check=cancelled_check,
                    lease_lost_event=lease_lost,  # type: ignore[arg-type]
                )
                # Give Windows pipe transports one loop turn to deliver their
                # connection-lost callbacks before asyncio closes the loop.
                await asyncio.sleep(0)
                return result

            return asyncio.run(run())

        task = asyncio.create_task(asyncio.to_thread(run_on_proactor))
        try:
            while not task.done():
                if lease_lost_event and lease_lost_event.is_set():
                    lease_lost.set()
                if (
                    (shutdown_event and shutdown_event.is_set())
                    or (cancellation_event and cancellation_event.is_set())
                    or await cancellation_check()
                ):
                    cancelled.set()
                await asyncio.sleep(0.05)
            return await task
        except BaseException:
            cancelled.set()
            with suppress(BaseException):
                await asyncio.shield(task)
            raise

    async def health(self) -> RuntimeHealthResultV1:
        result, _ = await self.invoke(
            operation="health", payload={}, request_id="startup_health"
        )
        return RuntimeHealthResultV1.model_validate(result)

    async def version(self) -> RuntimeVersionResultV1:
        result, _ = await self.invoke(
            operation="version", payload={}, request_id="startup_version"
        )
        return RuntimeVersionResultV1.model_validate(result)

    async def derive_project(self, **kwargs) -> tuple[DerivationRuntimeResultV1, tuple[str, ...]]:
        result, warnings = await self.invoke(operation="derive_project", **kwargs)
        try:
            return DerivationRuntimeResultV1.model_validate(result), warnings
        except ValidationError as exc:
            raise ClippingRuntimeError(
                "derived_result_invalid", "The Rust derivation result is invalid."
            ) from exc

    async def convert_project(self, **kwargs) -> tuple[ConversionRuntimeResultV1, tuple[str, ...]]:
        result, warnings = await self.invoke(operation="convert_project", **kwargs)
        try:
            return ConversionRuntimeResultV1.model_validate(result), warnings
        except ValidationError as exc:
            raise ClippingRuntimeError(
                "conversion_result_invalid", "The Rust conversion result is invalid."
            ) from exc
