# Capinsta project conversion V1

`contracts/clip-project-conversion-input-v1.schema.json` and
`contracts/capinsta-project-conversion-result-v1.schema.json` define the JSON
transport boundary. Rust structs in `rust/crates/project-bridge` implement the
same shape and own conversion behavior; the shared TypeScript package contains
consumer types and runtime validators, not a second converter.

## Input

`ClipProjectConversionInputV1` contains a validated `ClipProjectV1`, its
authoritative `EditDecisionListV1`, an optional `RemappedTranscriptV1`, a stable
target project ID, target Capinsta project version 35, explicit options, and
non-authoritative metadata. The EDL project ID, revision, source media, complete
entry list, and output duration must equal a newly derived `clip-domain` EDL.

Conversion V1 supports captions on/off and `error`/`warn` unsupported-feature
policies. Preserving disabled ranges and creating one track per range are
explicitly rejected because V1 does not implement those modes.

## Result

`CapinstaProjectConversionResultV1` contains the current serialized Capinsta
`TProject` version-35 shape, a source-media attachment reference, explicit
range/caption mappings, deterministically ordered warnings, and transport
metadata copied from the input.

The project timeline uses Capinsta integer `MediaTime` ticks: 120,000 ticks per
second, or exactly 120 ticks per contract millisecond. Mapping records remain in
integer milliseconds. The media reference deliberately omits `storageKey` and
local paths. `requiresMediaAttachment: true` tells future orchestration to
associate the existing asset with the target project-scoped media store; no
binary copy occurs in conversion.

## Issues and versioning

Issues carry category, severity, field path, project/range/EDL/caption
identifiers, and relevant timing values. Errors cover input, revision, media,
project-version, rate, canvas, duration, reference, mapping, generated-ID, and
overflow failures. Warnings cover disabled ranges, untimed caption words,
caption metadata, safe area, defaulted fields, and unused metadata.

Warning order is `(category, fieldPath, rangeId, captionOccurrenceId)`. With
policy `error`, warnings representing unsupported data become errors; harmless
defaults and disabled-range omission remain warnings.

Changes that reinterpret the input, mappings, or deterministic IDs require a
new conversion schema version. V1 explicitly rejects Capinsta versions other
than 35.
