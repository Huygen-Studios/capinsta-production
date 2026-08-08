# Capinsta + OpenCut Classic Integration

Capinsta Editor combines OpenCut Classic as the browser editor foundation with the Capinsta FastAPI backend as the caption engine.

OpenCut Classic remains responsible for media import, timeline editing, preview composition, project persistence, and export orchestration.

Capinsta is responsible for upload/job polling, transcription normalization, word timing, caption documents, active-word metadata, style presets, edit/timing sync, and caption export render data.

## Why OpenCut Classic

The earlier OpenCut rewrite checkout did not contain a complete editor. OpenCut Classic provided the real media, timeline, preview, project, and export surfaces needed for a production integration.

## What Was Intentionally Not Copied

The old Capinsta frontend editor shell, timeline, player, and store were not copied. The integration uses OpenCut Classic architecture with isolated Capinsta modules.

## Frontend Integration Points

- `apps/web/src/capinsta`
- `apps/web/src/subtitles/components/assets-view.tsx`
- `apps/web/src/preview/components/capinsta-active-caption-overlay.tsx`
- `apps/web/src/components/editor/panels/properties`
- `apps/web/src/services/renderer`

## Backend Integration Points

- `backend/server`
- `backend/ai_pipeline`
- `backend/tests`

## Feature Flags

- `NEXT_PUBLIC_ENABLE_AI_CAPTIONS`
- `NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT`
- `NEXT_PUBLIC_CAPINSTA_DEBUG`

Normal OpenCut text/subtitles and export remain available without the Capinsta backend. Capinsta metadata is optional and backward-compatible.
