# Recommendation API

`GET /clipping/projects/{project_id}/recommendations` lists rows matching the
project owner, transcript revision, and media revision. The default is current
`proposed` rows; filters support status, recommendation type, analysis ID, and
timed/untimed results. Pagination is signed and deterministic.
Its cursor is bound to the project and active filter set.

`POST /recommendations/decisions` requires the current project revision,
`Idempotency-Key`, and a unique batch of `accepted` or `rejected` decisions.
The transaction locks and validates every row. One invalid item rolls back the
batch. PostgreSQL supplies the time, and the verified actor supplies identity.
No project revision or analysis JSON changes.

Identical repeats are safe; conflicting repeats return a conflict. Stage 2
defers explicit reset because consumed-draft supersession is not yet defined.
