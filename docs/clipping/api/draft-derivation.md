# Accepted-recommendation draft derivation

`POST /clipping/projects/{project_id}/drafts/from-accepted-recommendations`
creates a synchronous project revision but never calculates an EDL. Only
accepted, ready, current-lineage recommendations are queried. Review-only,
unsupported, proposed, rejected, superseded, and untimed recommendations do
not edit ranges.

Supported `remove_silence` source exclusions are sorted and unioned, including
adjacent intervals. They are subtracted only from current enabled ranges.
Manual gaps, disabled ranges, explicit order, and playback rate are preserved.
Unaffected IDs survive; split fragment IDs derive from parent ID, bounds, and
sorted recommendation identity. Invalid timing is rejected, short fragments
are filtered, and outside exclusions generate warnings.

The input is not mutated. Project update, immutable
`accepted_recommendations` version, and consumption provenance commit
atomically. Insertions or deletions that change fragment bounds may change
split IDs.
