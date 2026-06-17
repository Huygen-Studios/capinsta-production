from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class SyncPassResult:
    segments: list[dict[str, Any]]
    report: dict[str, Any]


@dataclass
class SyncReport:
    applied: bool = False
    shiftSeconds: float = 0.0
    skew: float = 1.0
    anchorSeconds: float = 0.0
    baselineScore: float = 0.0
    bestScore: float = 0.0
    improvement: float = 0.0
    quality: float = 0.0
    reason: str = ""
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_sync_report(
    *,
    stable_ts: dict[str, Any] | None = None,
    auto_global_sync: dict[str, Any] | None = None,
    manual_sync: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "stableTs": stable_ts or {},
        "autoGlobalSync": auto_global_sync or {},
        "manualSync": manual_sync or {},
    }
