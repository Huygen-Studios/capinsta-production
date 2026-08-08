import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.contracts.clip_project_v1 import ClipProjectV1
from server.clipping_orchestration.contracts import (
    CreateProjectRequest,
    DraftRequest,
    RecommendationDecisionRequest,
)
from server.clipping_orchestration.drafts import AcceptedRecommendationDraftService
from server.clipping_orchestration.identity import canonical_hash
from server.clipping_persistence.errors import PersistenceError
from server.clipping_persistence.validation import ensure_portable_json

ROOT = Path(__file__).parents[2]


def _project(ranges=None):
    value = json.loads(
        (ROOT / "contracts/fixtures/clip-project-v1/one-range.json").read_text("utf-8")
    )
    value["sourceMedia"]["durationMs"] = 60_000
    if ranges is not None:
        value["ranges"] = ranges
    return ClipProjectV1.model_validate(value)


def _range(
    range_id,
    start,
    end,
    order=0,
    *,
    enabled=True,
    playback_rate=1.0,
):
    return {
        "schemaVersion": 1,
        "id": range_id,
        "sourceMediaId": "media_001",
        "sourceStartMs": start,
        "sourceEndMs": end,
        "order": order,
        "playbackRate": playback_rate,
        "selection": None,
        "boundary": {
            "preRollMs": 0,
            "postRollMs": 0,
            "startAdjustedManually": True,
            "endAdjustedManually": True,
        },
        "transitionIn": None,
        "transitionOut": None,
        "enabled": enabled,
        "label": None,
        "metadata": {"manual": True},
    }


def _recommendation(
    recommendation_id,
    start,
    end,
    *,
    status="accepted",
    recommendation_type="remove_silence",
    action="exclude_source_interval",
):
    return {
        "id": recommendation_id,
        "status": status,
        "recommendation_type": recommendation_type,
        "source_start_ms": start,
        "source_end_ms": end,
        "recommendation": {
            "proposedAction": {"action": action},
        },
    }


def _bounds(result):
    return [
        (item.sourceStartMs, item.sourceEndMs)
        for item in result.project.ranges
        if item.enabled
    ]


def test_canonical_hash_ignores_property_order():
    assert canonical_hash({"b": 2, "a": 1}) == canonical_hash({"a": 1, "b": 2})


@pytest.mark.parametrize(
    ("exclusion", "expected"),
    [
        ((15_000, 20_000), [(12_000, 15_000), (20_000, 31_000)]),
        ((12_000, 15_000), [(15_000, 31_000)]),
        ((28_000, 31_000), [(12_000, 28_000)]),
        ((12_000, 31_000), []),
    ],
)
def test_range_subtraction_boundaries(exclusion, expected):
    result = AcceptedRecommendationDraftService().derive(
        _project(),
        [_recommendation("rec_001", *exclusion)],
        minimum_range_duration_ms=100,
    )
    assert _bounds(result) == expected


def test_overlapping_and_adjacent_exclusions_union_deterministically():
    recommendations = [
        _recommendation("rec_b", 18_000, 24_000),
        _recommendation("rec_a", 15_000, 20_000),
        _recommendation("rec_c", 24_000, 26_000),
    ]
    first = AcceptedRecommendationDraftService().derive(_project(), recommendations)
    second = AcceptedRecommendationDraftService().derive(
        _project(), list(reversed(recommendations))
    )
    assert _bounds(first) == [(12_000, 15_000), (26_000, 31_000)]
    assert first.derivation_identity == second.derivation_identity
    assert [item.id for item in first.project.ranges] == [
        item.id for item in second.project.ranges
    ]


def test_exclusion_spans_multiple_ranges_and_preserves_manual_exclusion():
    project = _project(
        [
            _range("range_a", 0, 10_000, 0),
            _range("range_b", 20_000, 30_000, 1),
        ]
    )
    result = AcceptedRecommendationDraftService().derive(
        project, [_recommendation("rec_span", 5_000, 25_000)]
    )
    assert _bounds(result) == [(0, 5_000), (25_000, 30_000)]
    assert (10_000, 20_000) not in _bounds(result)


def test_disabled_ranges_and_playback_rate_are_preserved():
    project = _project(
        [
            _range("range_enabled", 0, 10_000, 0, playback_rate=1.5),
            _range("range_disabled", 20_000, 30_000, 0, enabled=False, playback_rate=0.75),
        ]
    )
    result = AcceptedRecommendationDraftService().derive(
        project, [_recommendation("rec_cut", 4_000, 6_000)]
    )
    assert [item.playbackRate for item in result.project.ranges if item.enabled] == [1.5, 1.5]
    disabled = next(item for item in result.project.ranges if not item.enabled)
    assert disabled.id == "range_disabled"
    assert disabled.playbackRate == 0.75


def test_nonchronological_explicit_order_is_preserved():
    project = _project(
        [
            _range("later_source", 30_000, 40_000, 0),
            _range("earlier_source", 0, 10_000, 1),
        ]
    )
    result = AcceptedRecommendationDraftService().derive(
        project, [_recommendation("rec_cut", 32_000, 33_000)]
    )
    assert _bounds(result) == [(30_000, 32_000), (33_000, 40_000), (0, 10_000)]


def test_unaffected_range_id_preserved_and_split_ids_are_stable():
    project = _project(
        [_range("unchanged", 0, 10_000, 0), _range("changed", 20_000, 30_000, 1)]
    )
    result = AcceptedRecommendationDraftService().derive(
        project, [_recommendation("rec_cut", 23_000, 24_000)]
    )
    assert result.project.ranges[0].id == "unchanged"
    assert all(item.id.startswith("range_") for item in result.project.ranges[1:])
    assert all(item.id != "changed" for item in result.project.ranges[1:])


def test_minimum_range_duration_filters_short_fragments():
    result = AcceptedRecommendationDraftService().derive(
        _project(), [_recommendation("rec_cut", 12_050, 30_950)],
        minimum_range_duration_ms=100,
    )
    assert _bounds(result) == []
    assert "retained_fragment_below_minimum_removed" in result.warnings


def test_outside_range_warns_and_does_not_readd_source():
    project = _project([_range("manual", 10_000, 20_000)])
    result = AcceptedRecommendationDraftService().derive(
        project, [_recommendation("rec_outside", 30_000, 31_000)]
    )
    assert _bounds(result) == [(10_000, 20_000)]
    assert result.project.ranges[0].id == "manual"
    assert "recommendation_outside_retained_ranges" in result.warnings


def test_proposed_rejected_untimed_and_review_recommendations_do_not_edit():
    project = _project()
    result = AcceptedRecommendationDraftService().derive(
        project,
        [
            _recommendation("rec_proposed", 15_000, 16_000, status="proposed"),
            _recommendation("rec_rejected", 17_000, 18_000, status="rejected"),
            _recommendation("rec_untimed", None, None),
            _recommendation(
                "rec_review", 20_000, 21_000,
                recommendation_type="review_low_confidence",
                action="review_transcript_word",
            ),
        ],
    )
    assert _bounds(result) == [(12_000, 31_000)]
    assert result.consumed_recommendation_ids == ()
    assert "untimed_recommendation_ignored" in result.warnings


def test_invalid_timing_rejected():
    with pytest.raises(ValueError):
        AcceptedRecommendationDraftService().derive(
            _project(), [_recommendation("rec_bad", -1, 100)]
        )
    with pytest.raises(ValueError):
        AcceptedRecommendationDraftService().derive(
            _project(), [_recommendation("rec_bad", 59_000, 61_000)]
        )


def test_input_is_not_mutated_and_output_validates():
    project = _project()
    before = copy.deepcopy(project.model_dump(mode="json"))
    result = AcceptedRecommendationDraftService().derive(
        project, [_recommendation("rec_cut", 15_000, 16_000)]
    )
    assert project.model_dump(mode="json") == before
    ClipProjectV1.model_validate(result.project.model_dump(mode="json"))


def test_request_contracts_reject_owner_unknown_fields_and_duplicates():
    create = {
        "mediaAssetId": "11111111-1111-1111-1111-111111111111",
        "transcriptId": "tr_test",
        "name": "Test",
        "canvas": {"aspectRatio": "9:16", "width": 1080, "height": 1920},
    }
    CreateProjectRequest.model_validate(create)
    with pytest.raises(ValidationError):
        CreateProjectRequest.model_validate({**create, "ownerUserId": "forged"})
    with pytest.raises(ValidationError):
        RecommendationDecisionRequest.model_validate(
            {
                "expectedProjectRevision": 1,
                "decisions": [
                    {"recommendationId": "rec_a", "decision": "accepted"},
                    {"recommendationId": "rec_a", "decision": "rejected"},
                ],
            }
        )
    with pytest.raises(ValidationError):
        DraftRequest.model_validate(
            {
                "expectedProjectRevision": 1,
                "recommendationIds": ["rec_a", "rec_a"],
            }
        )


def test_request_metadata_is_bounded_and_portable():
    base = {
        "mediaAssetId": "11111111-1111-1111-1111-111111111111",
        "transcriptId": "tr_test",
        "name": "Test",
        "canvas": {"aspectRatio": "9:16", "width": 1080, "height": 1920},
    }
    with pytest.raises(ValidationError):
        CreateProjectRequest.model_validate(
            {**base, "metadata": {"oversized": "x" * 33_000}}
        )
    with pytest.raises(PersistenceError):
        ensure_portable_json({"signedUrl": "https://example.invalid/token"})
