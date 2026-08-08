# Non-destructive Capinsta project conversion

`project-bridge::convert_clip_project_to_capinsta` is the authoritative,
deterministic conversion engine. It borrows and validates source contracts,
re-derives the EDL with `clip-domain`, and never mutates the clip project,
transcript, or supplied EDL.

## Timeline and media

For video or unknown MIME types, each enabled EDL entry becomes one editable
element on the main video track. The element keeps source audio enabled, so no
duplicate audible track is created. Audio MIME types produce upload-audio
elements on one audio track and leave the required main video track empty.

Capinsta uses trailing trim semantics:

```text
trimStart = sourceStart
trimEnd = fullSourceDuration - sourceEnd
sourceDuration = fullSourceDuration
startTime = EDL outputStart
duration = EDL outputDuration
```

These values convert exactly from milliseconds to ticks at 120 ticks/ms.
Elements follow EDL order and are never merged. Repeated, overlapping, and
source-nonchronological ranges remain separate. Rates from `ClipProjectV1`
(0.25×–4×) fit Capinsta's current range and map to `retime.rate`; EDL output
boundaries remain authoritative.

Media IDs and `sourceAssetId` are reused. Conversion returns an attachment
record instead of copying a file or persisting a path. Future Stage 3
orchestration must attach the existing asset to Capinsta's target-project media
store before opening the project.

## Canvas and captions

Width, height, color background, and preset/custom mode map to project settings.
`9:16`, `16:9`, `1:1`, `4:5`, and custom dimensions are supported. Conversion
does not reframe or add crop keyframes. Safe area warns because the current
project has no corresponding field; a missing background defaults to black.

When enabled, conversion consumes only `RemappedTranscriptV1`. Timed segment
occurrences become editable text elements and neutral caption clips. Timed word
occurrences become neutral words plus Rust-caption canonical timing. Repeated
occurrences remain repeated. Displayed and original text remain separate.
Confidence, speaker, language, and low-confidence review state are retained
where supported. The exact V2 timing source is retained in
`timingSourceDetail`, while its render-compatible legacy value drives current
caption behavior. Untimed words receive no invented timing and are omitted with
a per-occurrence warning. A true filler flag warns because the current caption
shape cannot persist it.

## Identity, provenance, and validation

Generated IDs use these namespaces:

```text
{project}__main_scene
{project}__video
{project}__audio
{project}__captions
{project}__range__{rangeId}__video
{project}__range__{rangeId}__audio
{project}__caption_segment__{occurrenceId}
{project}__caption_word__{occurrenceId}
```

Current persisted IDs are unconstrained strings, so IDs are neither sanitized
nor truncated. They remain stable for unchanged range/occurrence IDs, including
after unrelated range insertion. A final global check rejects collisions.

Optional `capinstaClippingProvenance` survives project save/load and does not
affect rendering. It records source application, clip project ID/revision,
transcript ID, and conversion schema version without duplicating contracts or
storage data.

The bridge verifies matching IDs/revisions/media, the full authoritative EDL,
contiguous zero-based output, final duration, trims, caption timing/references,
mapping resolution, generated-ID uniqueness, project version, and checked tick
arithmetic.

V1 does not preserve disabled ranges, create separate range tracks, persist safe
areas, represent untimed caption words, invoke persistence, expose WASM, render,
copy media, retranscribe, or reverse-synchronize.

Generate fixtures with:

```text
cargo run -p project-bridge --bin generate-conversion-fixtures
```
