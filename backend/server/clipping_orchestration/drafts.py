from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

try:
    from contracts.clip_project_v1 import ClipProjectV1
except ImportError:
    from backend.contracts.clip_project_v1 import ClipProjectV1

from .identity import canonical_hash, stable_id


@dataclass(frozen=True)
class DraftResult:
    project: ClipProjectV1
    consumed_recommendation_ids: tuple[str, ...]
    warnings: tuple[str, ...]
    derivation_identity: str
    exclusion_intervals: tuple[tuple[int, int], ...]


class AcceptedRecommendationDraftService:
    schema_version = 1

    @staticmethod
    def _eligible(
        recommendations: list[dict[str, Any]],
        *,
        duration_ms: int,
        include_fillers: bool,
        include_silence: bool,
    ) -> tuple[list[tuple[int, int, str]], list[str], list[str]]:
        exclusions: list[tuple[int, int, str]] = []
        consumed: list[str] = []
        warnings: set[str] = set()
        seen: set[str] = set()
        for item in sorted(recommendations, key=lambda value: value["id"]):
            recommendation_id = item["id"]
            if recommendation_id in seen:
                warnings.add("duplicate_recommendation_ignored")
                continue
            seen.add(recommendation_id)
            if item.get("status") != "accepted":
                warnings.add("non_accepted_recommendation_ignored")
                continue
            recommendation_type = item.get("recommendation_type")
            payload = item.get("recommendation") or {}
            action = (payload.get("proposedAction") or {}).get("action")
            supported = (
                include_silence and recommendation_type == "remove_silence"
            ) or (
                include_fillers and recommendation_type == "review_filler"
            )
            if not supported or action != "exclude_source_interval":
                warnings.add("unsupported_recommendation_ignored")
                continue
            start, end = item.get("source_start_ms"), item.get("source_end_ms")
            if start is None or end is None:
                warnings.add("untimed_recommendation_ignored")
                continue
            if start < 0 or end <= start or end > duration_ms:
                raise ValueError("invalid recommendation timing")
            exclusions.append((int(start), int(end), recommendation_id))
            consumed.append(recommendation_id)
        return exclusions, sorted(consumed), sorted(warnings)

    @staticmethod
    def _union(
        values: list[tuple[int, int, str]]
    ) -> list[tuple[int, int, tuple[str, ...]]]:
        result: list[tuple[int, int, tuple[str, ...]]] = []
        for start, end, recommendation_id in sorted(values):
            if result and start <= result[-1][1]:
                old_start, old_end, ids = result[-1]
                result[-1] = (
                    old_start,
                    max(old_end, end),
                    tuple(sorted(set(ids + (recommendation_id,)))),
                )
            else:
                result.append((start, end, (recommendation_id,)))
        return result

    def derive(
        self,
        project: ClipProjectV1,
        recommendations: list[dict[str, Any]],
        *,
        draft_name: str | None = None,
        minimum_range_duration_ms: int = 100,
        include_accepted_fillers: bool = False,
        include_accepted_silence: bool = True,
    ) -> DraftResult:
        original = project.model_dump(mode="json")
        exclusions, consumed, initial_warnings = self._eligible(
            recommendations,
            duration_ms=project.sourceMedia.durationMs,
            include_fillers=include_accepted_fillers,
            include_silence=include_accepted_silence,
        )
        unioned = self._union(exclusions)
        warnings: set[str] = set(initial_warnings)
        enabled = sorted(
            (item for item in project.ranges if item.enabled),
            key=lambda item: (item.order, item.id),
        )
        disabled = [deepcopy(item) for item in project.ranges if not item.enabled]
        output_ranges: list[dict[str, Any]] = []
        overlapped_recommendations: set[str] = set()
        for source_range in enabled:
            fragments = [(source_range.sourceStartMs, source_range.sourceEndMs, tuple())]
            for exclusion_start, exclusion_end, recommendation_ids in unioned:
                next_fragments: list[tuple[int, int, tuple[str, ...]]] = []
                for start, end, contributing in fragments:
                    overlap_start = max(start, exclusion_start)
                    overlap_end = min(end, exclusion_end)
                    if overlap_end <= overlap_start:
                        next_fragments.append((start, end, contributing))
                        continue
                    overlapped_recommendations.update(recommendation_ids)
                    combined = tuple(sorted(set(contributing + recommendation_ids)))
                    if start < overlap_start:
                        next_fragments.append((start, overlap_start, combined))
                    if overlap_end < end:
                        next_fragments.append((overlap_end, end, combined))
                fragments = next_fragments
            if (
                len(fragments) == 1
                and fragments[0][0] == source_range.sourceStartMs
                and fragments[0][1] == source_range.sourceEndMs
            ):
                value = source_range.model_dump(mode="json")
                output_ranges.append(value)
                continue
            for start, end, contributing in fragments:
                if end - start < minimum_range_duration_ms:
                    warnings.add("retained_fragment_below_minimum_removed")
                    continue
                value = source_range.model_dump(mode="json")
                value["id"] = stable_id(
                    "range",
                    {
                        "parentRangeId": source_range.id,
                        "sourceStartMs": start,
                        "sourceEndMs": end,
                        "recommendationIds": list(contributing),
                    },
                )
                value["sourceStartMs"] = start
                value["sourceEndMs"] = end
                value["selection"] = None
                value["metadata"] = {
                    **value.get("metadata", {}),
                    "derivedFromRangeId": source_range.id,
                    "acceptedRecommendationIds": list(contributing),
                }
                output_ranges.append(value)
        if set(consumed) - overlapped_recommendations:
            warnings.add("recommendation_outside_retained_ranges")
        for index, value in enumerate(output_ranges):
            value["order"] = index
        output_ranges.extend(item.model_dump(mode="json") for item in disabled)
        now = datetime.now(timezone.utc)
        next_value = deepcopy(original)
        next_value["revision"] = project.revision + 1
        next_value["name"] = draft_name or project.name
        next_value["ranges"] = output_ranges
        next_value["status"] = "draft"
        next_value["updatedAt"] = now.isoformat()
        identity = canonical_hash(
            {
                "schemaVersion": self.schema_version,
                "clipProjectId": project.clipProjectId,
                "expectedRevision": project.revision,
                "recommendationIds": consumed,
                "minimumRangeDurationMs": minimum_range_duration_ms,
                "includeAcceptedFillers": include_accepted_fillers,
                "includeAcceptedSilence": include_accepted_silence,
            }
        )
        next_value["metadata"] = {
            **next_value.get("metadata", {}),
            "draftDerivation": {
                "schemaVersion": 1,
                "identity": identity,
                "recommendationIds": consumed,
                "warnings": sorted(warnings),
            },
        }
        validated = ClipProjectV1.model_validate(next_value)
        if project.model_dump(mode="json") != original:
            raise RuntimeError("draft derivation mutated its input")
        return DraftResult(
            project=validated,
            consumed_recommendation_ids=tuple(consumed),
            warnings=tuple(sorted(warnings)),
            derivation_identity=identity,
            exclusion_intervals=tuple((start, end) for start, end, _ in unioned),
        )
