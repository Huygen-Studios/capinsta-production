# Transcript timing repair

Stage 2.6 reuses the established timing behavior in `ai_pipeline.main`,
`transcript_normalizer`, alignment, chunk merge, and timing-quality modules.
It does not evenly distribute words for display and does not change VAD.

Existing behavior prefers provider word timing, preserves deterministic chunk
offsets/order, applies the configured alignment/repair policy, and records
provenance such as provider/native, aligned/repaired, interpolated, estimated,
or unknown. Provider phrases and established synthetic/segment-derived
fallbacks map to `estimated`; no new fallback is introduced here.

At the durable boundary:

- All non-null timing is integer milliseconds.
- Negative timing and start-after-end are rejected.
- Material media-duration overflow is rejected and at most 50 ms of provider
  rounding overflow is clamped.
- Words with no safe paired range remain untimed.
- Zero-duration ranges remain valid under the V2 contract.
- Punctuation and character tokens remain ordinary ordered tokens.
- Overlapping segments remain valid and produce a warning, matching current
  multi-speaker/provider compatibility.
- Repaired timing remains distinguishable through `timingSource` and warnings.

The adapter is deterministic for the same normalized provider result. Audit
timestamps are excluded from semantic result identity, while timing and all
transcript content are included.

