# Automatic Clipper MVP

## Purpose

Stage 4 turns the existing private clipping pipeline into one usable workflow:
upload, durable processing, ranked candidate review, automatic 9:16 composition,
preview, MP4 export, and editable Capinsta handoff. It does not introduce a new
editor, renderer, queue, transcription provider, or project format.

All three Stage 4 feature flags are disabled by default:

```text
ENABLE_VIRAL_CANDIDATE_ANALYSIS=false
ENABLE_SMART_REFRAME=false
ENABLE_CLIPPER_UI=false
```

## Reused systems

- Private TUS uploads, media assets, PostgreSQL jobs, leases, cancellation, and
  Supabase Auth/RLS
- Media probing, proxy/audio variants, durable transcription, silence and
  transcript analysis
- `TranscriptDocumentV2`, `ClipProjectV1`, Rust EDL/remapping/conversion, and
  Capinsta's existing transform/keyframe representation
- Existing Chromium preview/export, H.264/AAC export persistence, signed
  downloads, and editable handoffs
- Existing caption renderer, presets, word highlighting, letter spacing, and
  word spacing
- Existing configured Gemini/OpenAI-compatible text-generation routing

## Durable model and jobs

Migration `0025_automatic_clipper.sql` extends transcript analysis with the
`viral_candidates` type and adds the focused `clip_candidates` table. A
candidate keeps its owner, project/media/transcript revisions, structured
candidate document, lifecycle state, reframe plan, composition, and result
identities. States are `proposed`, `selected`, `rejected`, and `superseded`.

The existing processing queue receives two job types:

- `viral_candidate_analysis`
- `smart_reframe`

Candidate generation waits for both the transcript review and silence analysis.
Selection queues smart reframe without changing the project revision. The
composition is finalized atomically only if the project, media, transcript,
candidate, job lease, and result identity are still current.

## Candidate analysis

`ViralCandidateAnalysisDocumentV1` is the persisted structured result.
The prompt version is server-owned (`viral-candidates-v1`); browser input cannot
provide a prompt, provider endpoint, credentials, or arbitrary metadata.
Provider output is size-bounded and validated before entering the Rust
normalizer. Raw provider output and full transcript text are neither persisted
nor logged.

The Rust normalizer:

- bounds candidates to eight and normally 20–90 seconds;
- clamps component and total scores to 0–100;
- snaps boundaries to timed words and nearby safe silence boundaries without
  cutting a word;
- accepts segment-only transcripts without inventing word timing;
- penalizes silence or low-confidence openings and weak payoff;
- deduplicates overlapping proposals; and
- sorts by score, then source timing.

Stable analysis/candidate IDs derive from immutable revision inputs and order.
Same-key regeneration replays the same analysis; a new key creates a distinct
server-owned analysis-spec identity. Finalization supersedes only earlier
unselected proposals. IDs are not promised to survive changed candidate order.
Scores are editorial ranking signals, not guarantees of virality.

## Scene, face, and layout analysis

The worker invokes existing FFmpeg scene-change detection only over the selected
candidate and samples a bounded number of frames. MediaPipe Tasks Face Detector
runs in video mode on CPU with the bundled short-range BlazeFace model. Tracking
resets at scene boundaries. Only normalized boxes, confidence, timestamp, and a
local track number enter the plan; frames and biometric identity are never
stored.

Bundled model:

```text
backend/assets/mediapipe/blaze_face_short_range-float16-v1.tflite
SHA-256 b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f
```

The Apache-2.0 license and model notice live beside the asset.

`ReframePlanV1` is produced by `shorts-domain` with deterministic shots,
reason codes, layout regions, confidence, and editable crop keyframes.
Centralized ratio behavior is:

- 9:16: preserve vertical framing by default;
- 1:1: single persistent face uses a safe crop, otherwise full-frame fit over a
  blurred background;
- 16:9: one dominant face uses a safe crop, two persistent faces use split
  regions, a small off-center speaker uses speaker/screen stacking, and
  uncertain/no-face content uses full-frame blurred fit.

Crop paths use a dead zone, bounded movement, minimum keyframe spacing, stable
scale and shot resets. Adjacent equivalent shots are merged. Detector/model
failure returns `fit_blurred_background`; optional CV failure does not fail the
composition.

## Hook, emoji, safe zones, and captions

`HookOverlayV1` is separate from captions and remains a normal editable text
track. The generated hook is transcript-supported, limited to 120 characters,
two lines, and zero to two emojis. Users can edit or remove both.

`NotoColorEmoji.ttf` is bundled under `apps/web/public/emoji-fonts` with its OFL
license. The same local font face is available to the interactive editor and
Chromium renderer; no rendering-time download or remote URL is stored.
Unsupported glyphs fall through the browser's normal font fallback.

Rust owns the versioned safe-zone profiles:

- `shorts-generic-v1`
- `tiktok-v1`
- `reels-v1`
- `youtube-shorts-v1`

Each profile centralizes top, bottom, right-control, hook, caption, and subject
areas. These are conservative presets, not a claim of permanent
platform-perfect placement.

Caption composition applies the selected existing preset, maximum two lines,
bounded width, profile position, and existing word spacing through editable
style overrides. It does not generate caption text or introduce a renderer.
The export adapter passes the converted project to the existing `/render`
surface, which paints the automatic hook independently from subtitles so both
remain visible and use the same frame clock.

## Composition and UI

The `compose_short` Rust operation is the domain composition service. It applies
the candidate interval, accepted in-candidate silence recommendations, safe
zone, reframe metadata, hook, and caption plan to a revision-bound
`ClipProjectV1`. Accepted silence may create several ordered ranges; EDL,
transcript remapping, and Capinsta conversion remain existing Rust operations.
Blurred layouts use editable background/foreground video layers, and crop
keyframes become editable Capinsta transforms.

`/clipper` is an authenticated UI shell. It persists resumable upload identity
and active media workflow state in local storage, safely polls existing APIs,
reviews/selects/rejects candidates, edits composition options, opens a
revision-bound editor preview, starts/cancels durable export, downloads a signed
ready result, and opens an editable Capinsta handoff. No signed URL is persisted.

## Authenticated APIs

```text
GET  /clipping/projects/{projectId}/candidates
POST /clipping/projects/{projectId}/candidates/{candidateId}/select
POST /clipping/projects/{projectId}/candidates/{candidateId}/reject
POST /clipping/projects/{projectId}/candidates/regenerate
GET  /clipping/media/{mediaAssetId}/automatic-workflow
```

Existing media, project, preview, export, download, and handoff APIs complete
the workflow. Mutations are owner-scoped, idempotent, revision-bound, and
server-authoritative.

## Operational bounds and limitations

- Initial candidate count is eight; planning provider input/output, frame
  sampling, subprocess output, and timeouts are bounded.
- CPU-only short-range face detection favors talking-head content. It does not
  detect arbitrary objects or understand screen content semantically.
- Manual crop refinement uses the existing Capinsta editor after handoff.
- Provider outage currently falls back to deterministic transcript windows;
  title/hook quality is deliberately conservative.
- Optional smart reframe and UI require their flags plus the bundled assets.
- Production still needs deployed Supabase/Coolify validation, monitoring,
  quotas, privacy operations, and rate limiting in Stage 5.
