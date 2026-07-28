from __future__ import annotations

import os
from dataclasses import dataclass


def _enabled(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() in {"1", "true", "yes", "on"}


def _bounded(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


@dataclass(frozen=True)
class ClippingOrchestrationConfig:
    api_enabled: bool = False
    decisions_enabled: bool = False
    drafts_enabled: bool = False
    derivations_enabled: bool = False
    conversions_enabled: bool = False
    maximum_ranges: int = 500
    maximum_decisions: int = 100
    maximum_draft_recommendations: int = 500
    maximum_page_size: int = 100

    @classmethod
    def from_env(cls) -> "ClippingOrchestrationConfig":
        return cls(
            api_enabled=_enabled("ENABLE_CLIPPING_PROJECT_API"),
            decisions_enabled=_enabled("ENABLE_RECOMMENDATION_DECISIONS"),
            drafts_enabled=_enabled("ENABLE_ACCEPTED_RECOMMENDATION_DRAFTS"),
            derivations_enabled=_enabled("ENABLE_PROJECT_DERIVATION_REQUESTS"),
            conversions_enabled=_enabled("ENABLE_PROJECT_CONVERSION_REQUESTS"),
            maximum_ranges=_bounded("CLIPPING_PROJECT_MAX_RANGES", 500, 1, 5000),
            maximum_decisions=_bounded(
                "CLIPPING_RECOMMENDATION_DECISION_BATCH_MAX", 100, 1, 500
            ),
            maximum_draft_recommendations=_bounded(
                "CLIPPING_DRAFT_RECOMMENDATION_MAX", 500, 1, 5000
            ),
            maximum_page_size=_bounded(
                "CLIPPING_PROJECT_PAGE_SIZE_MAX", 100, 1, 100
            ),
        )
