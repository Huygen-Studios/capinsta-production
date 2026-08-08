from __future__ import annotations

import os
from dataclasses import dataclass


def _enabled(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() in {"1", "true", "yes", "on"}


def _integer(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


@dataclass(frozen=True)
class ClippingRuntimeConfig:
    enabled: bool = False
    derivation_handler_enabled: bool = False
    conversion_handler_enabled: bool = False
    binary: str = "capinsta-clipping-runtime"
    protocol_version: int = 1
    timeout_seconds: int = 120
    derivation_timeout_seconds: int = 120
    conversion_timeout_seconds: int = 120
    terminate_grace_seconds: int = 3
    maximum_stdin_bytes: int = 64 * 1024 * 1024
    maximum_stdout_bytes: int = 128 * 1024 * 1024
    maximum_stderr_bytes: int = 64 * 1024

    @classmethod
    def from_env(cls) -> "ClippingRuntimeConfig":
        return cls(
            enabled=_enabled("ENABLE_CLIPPING_RUST_RUNTIME"),
            derivation_handler_enabled=_enabled(
                "ENABLE_PROJECT_DERIVATION_HANDLER"
            ),
            conversion_handler_enabled=_enabled(
                "ENABLE_PROJECT_CONVERSION_HANDLER"
            ),
            binary=(os.getenv("CLIPPING_RUNTIME_BINARY") or "capinsta-clipping-runtime").strip(),
            protocol_version=_integer(
                "CLIPPING_RUNTIME_PROTOCOL_VERSION", 1, 1, 255
            ),
            timeout_seconds=_integer(
                "CLIPPING_RUNTIME_TIMEOUT_SECONDS", 120, 1, 3600
            ),
            derivation_timeout_seconds=_integer(
                "PROJECT_DERIVATION_TIMEOUT_SECONDS", 120, 1, 3600
            ),
            conversion_timeout_seconds=_integer(
                "PROJECT_CONVERSION_TIMEOUT_SECONDS", 120, 1, 3600
            ),
            terminate_grace_seconds=_integer(
                "CLIPPING_RUNTIME_TERMINATE_GRACE_SECONDS", 3, 1, 30
            ),
            maximum_stdin_bytes=_integer(
                "CLIPPING_RUNTIME_MAX_STDIN_BYTES",
                64 * 1024 * 1024,
                1024,
                256 * 1024 * 1024,
            ),
            maximum_stdout_bytes=_integer(
                "CLIPPING_RUNTIME_MAX_STDOUT_BYTES",
                128 * 1024 * 1024,
                1024,
                512 * 1024 * 1024,
            ),
            maximum_stderr_bytes=_integer(
                "CLIPPING_RUNTIME_MAX_STDERR_BYTES", 64 * 1024, 1024, 1024 * 1024
            ),
        )

    def validate_handler_flags(self) -> None:
        if (
            self.derivation_handler_enabled or self.conversion_handler_enabled
        ) and not self.enabled:
            raise ValueError("Clipping runtime handlers require ENABLE_CLIPPING_RUST_RUNTIME")
        if self.enabled and not self.binary:
            raise ValueError("CLIPPING_RUNTIME_BINARY is required")

