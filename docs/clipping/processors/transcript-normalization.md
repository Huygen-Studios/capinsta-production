# Durable transcript normalization

The existing provider router, adapters, `run_pipeline`, transcript normalizer,
language normalization, chunk merge, and timing repair execute first. A narrow
Stage 2.6 adapter then maps that normalized result to the authoritative
`TranscriptDocumentV2`; it is not a second provider pipeline.

Segments and words preserve their input order. Existing IDs are retained;
otherwise stable order-based IDs use `seg_000001` and `word_000001`. Displayed
text and original provider text remain separate. Confidence, language,
speaker, filler, low-confidence, and timing-provenance values are copied when
available. Missing confidence, speaker data, or timing remains absent rather
than fabricated.

Provider seconds are converted once to integer milliseconds. A paired missing
word range remains nullable. A partially timed word is conservatively made
untimed with a warning. Negative values, invalid confidence, malformed
segments/words, and material duration overflow reject the response. A
provider rounding overflow of at most 50 ms is clamped and warned.

The adapter retains only bounded, reviewed metadata fields. It does not copy
SDK objects, complete raw responses, signed URLs, local paths, storage
identities, or credentials. The complete document is validated again with the
shared V2 Pydantic model before persistence.

Warnings are sorted machine-readable codes. Current codes include
`confidence_missing`, `duration_mismatch_clamped`, `hotwords_not_supported`,
`language_auto_detected`, `overlapping_segments_preserved`,
`provider_fallback_used`, `provider_text_normalized`,
`untimed_word_preserved`, `word_timing_missing`, and
`word_timing_repaired`.

Hotwords are accepted as bounded request policy but existing provider adapters
do not expose one uniform durable hotword mapping. They are not silently
applied: requests containing them receive `hotwords_not_supported`. Dynamic
vocabulary support is a follow-up after the existing router has a
provider-neutral capability.

