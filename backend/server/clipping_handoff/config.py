from __future__ import annotations

import os
from dataclasses import dataclass


def _enabled(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _integer(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


@dataclass(frozen=True)
class HandoffConfig:
    enabled: bool = False
    server_backed_media_enabled: bool = True
    ttl_seconds: int = 900
    maximum_ttl_seconds: int = 3600
    maximum_manifest_bytes: int = 64 * 1024 * 1024

    @classmethod
    def from_env(cls) -> "HandoffConfig":
        maximum_ttl = _integer(
            "CLIPPING_HANDOFF_MAX_TTL_SECONDS", 3600, 60, 86_400
        )
        ttl = _integer("CLIPPING_HANDOFF_TTL_SECONDS", 900, 60, maximum_ttl)
        return cls(
            enabled=_enabled("ENABLE_CAPINSTA_PROJECT_HANDOFF"),
            server_backed_media_enabled=_enabled(
                "ENABLE_SERVER_BACKED_EDITOR_MEDIA", "true"
            ),
            ttl_seconds=ttl,
            maximum_ttl_seconds=maximum_ttl,
            maximum_manifest_bytes=_integer(
                "CLIPPING_HANDOFF_MAX_MANIFEST_BYTES",
                64 * 1024 * 1024,
                1024,
                128 * 1024 * 1024,
            ),
        )

