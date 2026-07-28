# ClipProjectV1 to Capinsta mapping

Task 1.4 implements this mapping in Rust `project-bridge`. The source media ID
maps to the same Capinsta `mediaId` and `sourceAssetId`; a separate attachment
record tells later orchestration to associate the existing binary with the
target project without copying or re-uploading it.

Each enabled EDL entry maps to one combined video/source-audio element, or one
audio element for an explicit audio MIME type. Capinsta `trimStart` is the EDL
source start, `trimEnd` is full source duration minus source end, and timeline
start/duration come directly from EDL output boundaries. Playback rate maps to
`retime.rate`. Separate entries are never merged.

Canvas dimensions/background map to project settings. Safe area warns because
the current project has no corresponding field. An optional remapped transcript
maps to existing editable Capinsta caption-document and text-track structures.
Full behavior, IDs, limitations, and issue categories are documented in
`docs/clipping/domain/capinsta-project-conversion.md`.
