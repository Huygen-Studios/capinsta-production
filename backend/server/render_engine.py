from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import Any


class RenderEngine(str, Enum):
    BROWSER_FULL_FRAME = "browser_full_frame"
    BROWSER_SPARSE = "browser_sparse"
    ASS_FAST_PATH = "ass_fast_path"


@dataclass(frozen=True)
class RenderSegment:
    start_frame: int
    end_frame_exclusive: int
    capture_frame: int
    time_seconds: float
    duration_frames: int
    reason: str

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "startFrame": self.start_frame,
            "endFrameExclusive": self.end_frame_exclusive,
            "captureFrame": self.capture_frame,
            "timeSeconds": self.time_seconds,
            "durationFrames": self.duration_frames,
            "reason": self.reason,
        }


def _frame_at_or_after(seconds: float, fps: int) -> int:
    return max(0, math.ceil(max(0.0, seconds) * fps - 1e-9))


def _style_value(style: dict[str, Any], flat: str, nested: str, default: Any) -> Any:
    if flat in style:
        return style[flat]
    animation = style.get("animation")
    if isinstance(animation, dict) and nested in animation:
        return animation[nested]
    return default


def sparse_compatibility_reason(theme: str, style_config: dict[str, Any] | None) -> str | None:
    sparse_capable_themes = {
        "word_highlight_box",
        "viral_word_highlight",
        "mrbeast_style",
        "apple_cinematic",
        "kinetic_fade",
        "attention_punch",
        "modern_minimalist_lockup",
        "dynamic_punch",
        "minimal",
        "outline_bold",
    }
    if theme not in sparse_capable_themes:
        return f"unsupported_theme:{theme}"
    style = style_config or {}
    word_effect = str(_style_value(style, "wordEffect", "wordEffect", "pop"))
    animation_type = str(_style_value(style, "animationType", "type", "pop"))
    entrance = str(_style_value(style, "entranceAnimation", "entrance", "none"))
    if word_effect not in {"none", "highlight", "paint", "pop", "bounce", "fade", "reveal"}:
        return f"unsupported_word_effect:{word_effect}"
    if animation_type not in {"none", "pop", "bounce"}:
        return f"unsupported_animation_type:{animation_type}"
    if entrance not in {"none", "fade", "flip", "pop", "slide"}:
        return f"unsupported_entrance:{entrance}"
    prohibited = {
        "continuousGradient",
        "gradientAnimation",
        "blurAnimation",
        "wallClockAnimation",
        "randomAnimation",
    }
    enabled = [key for key in prohibited if bool(style.get(key))]
    if enabled:
        return f"unsupported_continuous_effect:{','.join(sorted(enabled))}"
    return None


def can_use_sparse_render(theme: str, style_config: dict[str, Any] | None) -> bool:
    return sparse_compatibility_reason(theme, style_config) is None


def select_render_engine(
    theme: str,
    style_config: dict[str, Any] | None,
    export_mode: str,
    *,
    sparse_enabled: bool,
    sparse_themes: set[str],
) -> tuple[RenderEngine, str | None]:
    del export_mode  # Both browser export modes share the caption overlay renderer.
    if not sparse_enabled:
        return RenderEngine.BROWSER_FULL_FRAME, "sparse_disabled"
    if "*" not in sparse_themes and theme not in sparse_themes:
        return RenderEngine.BROWSER_FULL_FRAME, f"theme_not_enabled:{theme}"
    reason = sparse_compatibility_reason(theme, style_config)
    if reason:
        return RenderEngine.BROWSER_FULL_FRAME, reason
    return RenderEngine.BROWSER_SPARSE, None


def build_sparse_caption_render_plan(
    captions: list[dict[str, Any]],
    fps: int,
    theme: str,
    style_config: dict[str, Any] | None,
    duration: float,
) -> list[RenderSegment]:
    reason = sparse_compatibility_reason(theme, style_config)
    if reason:
        raise ValueError(reason)
    if fps <= 0 or duration <= 0:
        raise ValueError("fps and duration must be positive")

    total_frames = max(1, math.ceil(duration * fps))
    style = style_config or {}

    reasons: dict[int, set[str]] = {0: {"timeline_start"}, total_frames: {"timeline_end"}}

    def add(frame: int, why: str) -> None:
        if 0 <= frame <= total_frames:
            reasons.setdefault(frame, set()).add(why)

    for caption in captions:
        if not isinstance(caption, dict):
            continue
        caption_style = dict(style)
        if isinstance(caption.get("style"), dict):
            caption_style.update(caption["style"])
        caption_theme = str(caption.get("theme") or theme)
        caption_reason = sparse_compatibility_reason(caption_theme, caption_style)
        if caption_reason:
            raise ValueError(caption_reason)
        speed = max(
            0.4,
            float(_style_value(caption_style, "animationSpeed", "speed", 1) or 1),
        )
        smoothness = min(
            1.0,
            max(
                0.0,
                float(
                    _style_value(
                        caption_style,
                        "animationSmoothness",
                        "smoothness",
                        0.72,
                    )
                    or 0
                ),
            ),
        )
        animation_type = str(
            _style_value(caption_style, "animationType", "type", "pop")
        )
        word_effect = str(
            _style_value(caption_style, "wordEffect", "wordEffect", "pop")
        )
        entrance = str(
            _style_value(caption_style, "entranceAnimation", "entrance", "none")
        )
        caption_start = _frame_at_or_after(float(caption.get("start") or 0), fps)
        caption_end = min(total_frames, _frame_at_or_after(float(caption.get("end") or 0), fps))
        add(caption_start, "caption_start")
        add(caption_end, "caption_end")

        if entrance != "none":
            entrance_frames = max(2, math.ceil(12 / speed))
            for frame in range(caption_start, min(total_frames, caption_start + entrance_frames) + 1):
                add(frame, "caption_entrance")

        words = caption.get("words") or []
        if not isinstance(words, list):
            continue
        for word in words:
            if not isinstance(word, dict):
                continue
            word_start = min(total_frames, _frame_at_or_after(float(word.get("start") or 0), fps))
            word_end = min(total_frames, _frame_at_or_after(float(word.get("end") or 0), fps))
            add(word_start, "word_start")
            add(word_end, "word_end")
            if word_effect in {"pop", "bounce", "highlight"} and animation_type != "none":
                peak = max(2.0, (3 + smoothness * 2) / speed)
                settle = max(peak + 2, (8 + smoothness * 4) / speed)
                last_motion_frame = min(word_end, word_start + math.ceil(settle))
                for frame in range(word_start, last_motion_frame + 1):
                    add(frame, "active_word_animation")
            elif word_effect in {"fade", "reveal"}:
                reveal_duration = max(
                    0.18,
                    float(caption_style.get("revealDuration") or 0.32),
                )
                reveal_frames = max(2, math.ceil(reveal_duration * fps / speed))
                last_motion_frame = min(word_end, word_start + reveal_frames)
                for frame in range(word_start, last_motion_frame + 1):
                    add(frame, "active_word_reveal")

    boundaries = sorted(reasons)
    segments: list[RenderSegment] = []
    for start, end in zip(boundaries, boundaries[1:]):
        if end <= start or start >= total_frames:
            continue
        segment_end = min(end, total_frames)
        segments.append(
            RenderSegment(
                start_frame=start,
                end_frame_exclusive=segment_end,
                capture_frame=start,
                time_seconds=start / fps,
                duration_frames=segment_end - start,
                reason="+".join(sorted(reasons[start])),
            )
        )

    validate_sparse_render_plan(segments, total_frames)
    return segments


def validate_sparse_render_plan(plan: list[RenderSegment], total_frames: int) -> None:
    if not plan:
        raise ValueError("sparse plan is empty")
    cursor = 0
    for segment in plan:
        if segment.start_frame != cursor:
            raise ValueError(f"sparse plan gap/overlap at frame {cursor}")
        if segment.end_frame_exclusive <= segment.start_frame:
            raise ValueError("sparse plan contains an empty segment")
        if segment.capture_frame != segment.start_frame:
            raise ValueError("sparse capture frame must equal segment start")
        cursor = segment.end_frame_exclusive
    if cursor != total_frames:
        raise ValueError(f"sparse plan ends at {cursor}, expected {total_frames}")
