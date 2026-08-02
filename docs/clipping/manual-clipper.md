# Editor-first manual Clipper

`/clipper` uploads one private source through the existing multipart media API,
waits only for probe readiness, creates a durable clip batch, and opens the
existing CapInsta editor. The former automatic workflow remains available at
`/clipper/automatic`; creating a manual batch does not enqueue transcription,
candidate analysis, or smart reframe work.

## Durable model

Migration `0032_manual_clip_batches.sql` adds owner-scoped batches, independently
revisioned items, and batch-export records. All browser mutations go through the
authenticated FastAPI boundary; authenticated database clients have read-only
RLS access. Items share the batch source media asset and store half-open source
ranges. The API, database constraint, TypeScript interaction helper, and Rust
domain validator reject ranges outside `0 < duration <= 180000` milliseconds.
Ranges may overlap and reordering changes only `ordinal`.

Materialization reuses the existing clipping orchestration, Rust EDL derivation,
v35 project conversion, private-media handoff, editor storage, and renderer. One
child project is created idempotently per item. Once materialized, a range is
locked. `Reset edits` uses the existing project-deletion boundary and requires
confirmation before the range can change.

## Captions and headings

Captions are opt-in. The batch caption endpoint downloads the private source,
extracts only the selected range to WAV, and submits that bounded audio through
the existing caption job. The client runs batch requests sequentially, so at
most one item is active. Each child has its own canonical transcript. A caption
job is reported complete only after that transcript is persisted, the child
project revision is advanced, and the existing Rust derivation/conversion path
has produced normal editable CapInsta caption documents. Opening a child editor
is not required, retries do not duplicate caption elements, and immediate export
uses the persisted captioned revision.

Headings use a normal editor text element named `Clip heading` with placeholder
text `Add a heading`. It can be edited, styled, animated, moved, resized, or
deleted with standard editor controls.

## Export and restoration

Before a batch export, locally saved v35 child projects are validated and synced
into their existing conversion record; stale browser snapshots never replace a
newer server revision. The existing private export jobs then render the actual
edited project. A single selection downloads its MP4 directly. Multi-selection
results are archived with sanitized filenames and `manifest.json`, stored in
private export storage, and returned through the existing expiring-download
boundary. The active batch ID is restored from browser storage; durable
idempotency prevents duplicate source or child projects after refresh.

Deleting from the batch workspace removes its child projects first, then asks
the existing media-deletion service to remove the shared source. That service
deletes the object only when no other active project references it; repeated
deletion is idempotent.

## Operations

Apply migrations with the normal production migration runner. Migration `0032`
is additive and requires no new environment variables. Deploy web, API, workers,
and renderer from the same immutable image tag after Linux verification passes.
