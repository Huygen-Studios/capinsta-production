# Timeline recommendations

`TimelineRecommendationV1` is a review proposal in source-media milliseconds.
Controlled types are `remove_silence`, `review_filler`,
`review_low_confidence`, and `review_timing`. Controlled actions are
`exclude_source_interval`, `review_transcript_word`, and
`review_transcript_timing`; arbitrary patches and executable instructions are
invalid.

Recommendations preserve producing-analysis and contributing-finding IDs.
Timed proposals sort by start, end, type and stable ID; untimed proposals sort
last. Different types are not merged. Semantic duplicates are removed by
stable identity. Exclusion intervals must be positive and within media
duration.

Persistence creates only `proposed` rows. Atomic finalization replaces prior
proposed rows for the analysis, but never deletes future accepted/rejected
rows. This task does not accept, apply, map to output time, create ranges, or
generate an EDL.

Task 2.8 adds an explicit decision overlay without rewriting recommendation or
analysis JSON. Only `proposed -> accepted|rejected` is supported. Accepted
current-lineage `remove_silence` exclusions may be consumed by the
deterministic draft service; review recommendations remain advisory.
Consumption records bind recommendations to an exact project revision.
