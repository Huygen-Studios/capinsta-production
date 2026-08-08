# Local clipping export development

All Stage 3.3 features are disabled by default:

```env
ENABLE_CLIPPING_PREVIEW_API=true
ENABLE_CLIPPING_EXPORT_API=true
ENABLE_CLIPPING_EXPORT_HANDLER=true
CLIPPING_EXPORT_PRESET=vertical-mp4-v1
CLIPPING_EXPORT_STORAGE_BACKEND=local
CLIPPING_EXPORT_LOCAL_STORAGE_ROOT=/trusted/capinsta-storage
CLIPPING_EXPORT_TEMP_ROOT=/trusted/capinsta-export-tmp
```

Apply migrations through `0024_clipping_preview_exports.sql`, enable the
durable worker, and run the existing web render route used by headless export.
The handler validates the existing FFmpeg, FFprobe, Playwright, writable export
directory, and bundled/render-page runtime only when its feature flag is on.

Local Storage exercises real file upload and checksum behavior but does not
issue download URLs. Signed-download verification requires the Supabase adapter
or a focused mock. No real Supabase network request is required for local
render verification.

