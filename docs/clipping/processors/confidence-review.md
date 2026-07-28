# Confidence and timing review

`transcript-review-v1` uses the existing canonical confidence and
`isLowConfidence` fields. Its current threshold is 0.5, matching the durable
normalizer. Confidence below (not equal to) the threshold or an explicit
provider flag creates a review finding. Missing confidence creates a bounded
`confidence_missing` warning and is not fabricated or classified as low.

Adjacent low-confidence words may group only when they are consecutive,
within 300 ms (or both untimed), and share the same speaker identity. Findings
retain every word and segment ID.

Timing review reports missing and zero-duration word timing, overlaps,
near-boundary timing, and aligned/interpolated/estimated timing provenance.
Segment-only zero-duration timing and repaired segment provenance are also
reviewable. Analysis never reruns timing repair or changes timestamps.
