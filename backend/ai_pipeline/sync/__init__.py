"""Caption synchronization engine for Huygen Caps."""

from .affine import (
    apply_affine_time,
    clamp_segments_to_duration,
    retime_segments,
    retime_word,
    validate_monotonic_word_timing,
)
from .auto_sync import apply_auto_sync_if_confident, estimate_global_shift, estimate_global_shift_and_skew
from .stable_refine import apply_stable_refinement, stable_ts_available

__all__ = [
    "apply_affine_time",
    "apply_auto_sync_if_confident",
    "apply_stable_refinement",
    "clamp_segments_to_duration",
    "estimate_global_shift",
    "estimate_global_shift_and_skew",
    "retime_segments",
    "retime_word",
    "stable_ts_available",
    "validate_monotonic_word_timing",
]
