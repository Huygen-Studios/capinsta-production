import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from server.render_engine import (
    RenderEngine,
    build_sparse_caption_render_plan,
    can_use_sparse_render,
    select_render_engine,
    validate_sparse_render_plan,
)


CAPTIONS = [
    {
        "id": "caption-1",
        "start": 1.0,
        "end": 3.0,
        "text": "hello world",
        "words": [
            {"id": "word-1", "text": "hello", "start": 1.0, "end": 1.8},
            {"id": "word-2", "text": "world", "start": 1.8, "end": 3.0},
        ],
    }
]


def test_sparse_plan_covers_timeline_without_gaps_or_overlaps():
    plan = build_sparse_caption_render_plan(CAPTIONS, 24, "word_highlight_box", {}, 4.0)
    validate_sparse_render_plan(plan, 96)
    assert plan[0].start_frame == 0
    assert plan[-1].end_frame_exclusive == 96
    assert any(segment.reason == "timeline_start" for segment in plan)
    assert any("caption_start" in segment.reason for segment in plan)
    assert any("caption_end" in segment.reason for segment in plan)


def test_sparse_plan_captures_each_continuous_pop_animation_frame():
    plan = build_sparse_caption_render_plan(CAPTIONS, 24, "word_highlight_box", {}, 4.0)
    starts = {segment.start_frame for segment in plan}
    word_start = 24
    assert all(frame in starts for frame in range(word_start, word_start + 12))
    assert len(plan) < 96


def test_sparse_plan_contains_transparent_intervals():
    plan = build_sparse_caption_render_plan(CAPTIONS, 24, "word_highlight_box", {}, 4.0)
    assert plan[0].start_frame == 0 and plan[0].end_frame_exclusive == 24
    assert plan[-1].start_frame == 72 and plan[-1].end_frame_exclusive == 96


def test_sparse_rejects_unknown_continuous_effects_and_themes():
    assert can_use_sparse_render("kinetic_fade", {})
    assert not can_use_sparse_render("word_highlight_box", {"gradientAnimation": True})
    with pytest.raises(ValueError, match="unsupported_theme"):
        build_sparse_caption_render_plan(CAPTIONS, 24, "unknown_theme", {}, 4.0)


def test_engine_selection_preserves_full_frame_fallback():
    assert select_render_engine(
        "word_highlight_box", {}, "full_video", sparse_enabled=False, sparse_themes={"word_highlight_box"}
    ) == (RenderEngine.BROWSER_FULL_FRAME, "sparse_disabled")
    assert select_render_engine(
        "kinetic_fade", {}, "full_video", sparse_enabled=True, sparse_themes={"word_highlight_box"}
    )[0] is RenderEngine.BROWSER_FULL_FRAME
    assert select_render_engine(
        "word_highlight_box", {}, "captions_only", sparse_enabled=True, sparse_themes={"word_highlight_box"}
    ) == (RenderEngine.BROWSER_SPARSE, None)
    assert select_render_engine(
        "kinetic_fade", {}, "full_video", sparse_enabled=True, sparse_themes={"*"}
    ) == (RenderEngine.BROWSER_SPARSE, None)


def test_sparse_fade_captures_only_bounded_reveal_interval():
    captions = [
        {
            **CAPTIONS[0],
            "theme": "kinetic_fade",
            "style": {
                "animation": {
                    "wordEffect": "fade",
                    "type": "none",
                    "entrance": "fade",
                }
            },
        }
    ]
    plan = build_sparse_caption_render_plan(captions, 30, "kinetic_fade", {}, 4.0)
    starts = {segment.start_frame for segment in plan}
    assert all(frame in starts for frame in range(30, 37))
    assert len(plan) < 120


def test_plan_is_frame_deterministic_for_fractional_boundaries():
    captions = [{"id": "c", "start": 0.1, "end": 0.9, "text": "x", "words": []}]
    first = build_sparse_caption_render_plan(captions, 30, "word_highlight_box", {}, 1.0)
    second = build_sparse_caption_render_plan(captions, 30, "word_highlight_box", {}, 1.0)
    assert first == second
    assert any(segment.start_frame == 3 for segment in first)
    assert any(segment.start_frame == 27 for segment in first)


def test_per_caption_static_animation_style_reduces_capture_boundaries():
    captions = [
        {
            **CAPTIONS[0],
            "style": {
                "animation": {
                    "wordEffect": "highlight",
                    "type": "none",
                    "entrance": "none",
                }
            },
        }
    ]
    plan = build_sparse_caption_render_plan(
        captions, 24, "word_highlight_box", {}, 4.0
    )
    assert {segment.start_frame for segment in plan} == {0, 24, 44, 72}
