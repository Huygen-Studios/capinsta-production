# Rounding and precision

Playback rates normalize once to fixed point at 1,000,000 units. Contract values are constrained to 0.25–4.0. Exact cumulative boundaries use checked integer arithmetic and are rounded half-up to milliseconds only at each cumulative boundary, preventing accumulated per-range rounding drift.

Mixed-rate increments are converted to fixed-point micro-milliseconds before accumulation. The 1,000-range regression test guarantees contiguous boundaries, final-endpoint equality, and deterministic repeated output.
