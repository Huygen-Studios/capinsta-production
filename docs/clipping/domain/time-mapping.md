# Deterministic time mapping

`clip-domain` is authoritative. Source ranges are half-open `[startMs, endMs)` and output ranges are contiguous derived intervals. A source point can map to every matching repeated or overlapping source occurrence; an output point maps to one entry. Internal output boundaries select the next entry; the final output endpoint selects the final source endpoint.

Disabled ranges are excluded. Explicit `order` controls output chronology and source chronology is never substituted. No output timestamp is persisted back into `ClipProjectV1`.

Intervals are validated as half-open and split at EDL boundaries. Source intervals return every repeated or overlapping output appearance; output intervals return one source interval per intersected entry.
