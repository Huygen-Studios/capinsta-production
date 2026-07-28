# Transcript remapping

`RemappedTranscriptV1` is a deterministic Rust-derived result. The default boundary policy is `clipped`; `contained` and `intersecting` are also supported. Original source bounds remain separate from effective clipped bounds. The default untimed policy is `excludeWithWarning`; `preserveUntimed` retains explicit null timing without interpolation.

Word IDs use `{rangeId}__{sourceWordId}` and segments use `{rangeId}__{sourceSegmentId}`. Repeated and overlapping ranges produce separate occurrences. Segments reconstruct timing from mapped words. Fixtures cover clipping, untimed exclusion/preservation, repeated occurrences, reconstruction, and displayed text differing from provider text.
