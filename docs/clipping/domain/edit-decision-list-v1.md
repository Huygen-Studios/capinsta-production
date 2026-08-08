# EditDecisionListV1

The EDL is an in-memory derived Rust model, not a persisted project schema. It contains deterministic `edl_<rangeId>` entries, source bounds, derived output bounds, and warnings. It contains no media paths or FFmpeg instructions.

Representative Rust-generated fixtures cover empty and all-disabled output, multiple and mixed-rate ranges, repeated and overlapping source regions, and cumulative fractional rounding. Invalid fixtures are manually reviewed.
