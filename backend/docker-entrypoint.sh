#!/bin/sh
set -eu

root="${LEGACY_CAPTION_STORAGE_ROOT:-/app/storage/legacy-caption}"
db_path="${DB_PATH:-${TEMP_DIR:-/tmp/huygen-caps}/database.sqlite}"
db_parent="$(dirname "$db_path")"
automatic_root="${AUTOMATIC_CLIPPER_TEMP_ROOT:-/tmp/capinsta-automatic-clipper}"
variant_root="${MEDIA_VARIANT_TEMP_ROOT:-/tmp/capinsta-media-variants}"
transcription_root="${TRANSCRIPTION_TEMP_ROOT:-/tmp/capinsta-transcription}"
clipping_export_root="${CLIPPING_EXPORT_TEMP_ROOT:-/tmp/capinsta-clipping-exports}"
mkdir -p \
  "$root/tmp" \
  "$root/uploads" \
  "$root/media" \
  "$root/exports" \
  "$root/cache" \
  "${TEMP_DIR:-$root/tmp}" \
  "${UPLOAD_DIR:-$root/uploads}" \
  "${MEDIA_DIR:-$root/media}" \
  "${EXPORT_DIR:-$root/exports}" \
  "${CACHE_DIR:-$root/cache}" \
  "$db_parent" \
  "$automatic_root" \
  "$variant_root" \
  "$transcription_root" \
  "$clipping_export_root"
for path in "$root" "${TEMP_DIR:-$root/tmp}" "${UPLOAD_DIR:-$root/uploads}" "${MEDIA_DIR:-$root/media}" "${EXPORT_DIR:-$root/exports}" "${CACHE_DIR:-$root/cache}" "$db_parent" "$automatic_root" "$variant_root" "$transcription_root" "$clipping_export_root"; do
  case "$path" in
    /app/storage|/app/storage/*|/tmp/huygen-caps|/tmp/huygen-caps/*|/tmp/capinsta-*) chown -R capinsta:capinsta "$path" ;;
    *) echo "refusing to chown unmanaged storage path: $path" >&2; exit 1 ;;
  esac
done

if [ "${CAPINSTA_RUN_MIGRATIONS_ON_STARTUP:-true}" = "true" ]; then
  gosu capinsta python -m server.production.migrate
fi

if [ "${CAPINSTA_EXPORT_ENGINE:-}" != "remotion_hybrid" ]; then
  exec gosu capinsta "$@"
fi

# The normal editor exporter is intentionally isolated from the clipping/media
# worker fleet even though both reuse the same durable job runner.
gosu capinsta env \
  ENABLE_DURABLE_PROCESSING_WORKER=true \
  ENABLE_EDITOR_EXPORT_HANDLER=true \
  PROCESSING_WORKER_ID="${EDITOR_EXPORT_WORKER_ID:-production-editor-export}" \
  PROCESSING_WORKER_REQUIRED_JOB_TYPES=editor_export \
  ENABLE_MEDIA_PROBE_HANDLER=false \
  ENABLE_MEDIA_VARIANT_HANDLERS=false \
  ENABLE_DURABLE_TRANSCRIPTION_HANDLER=false \
  ENABLE_TRANSCRIPT_ANALYSIS_HANDLERS=false \
  ENABLE_VIRAL_CANDIDATE_ANALYSIS=false \
  ENABLE_SMART_REFRAME=false \
  ENABLE_PROJECT_DERIVATION_HANDLER=false \
  ENABLE_PROJECT_CONVERSION_HANDLER=false \
  ENABLE_CLIPPING_EXPORT_HANDLER=false \
  python -m server.clipping_jobs.worker &
worker_pid=$!

gosu capinsta "$@" &
api_pid=$!

shutdown() {
  trap - EXIT INT TERM
  kill -TERM "$api_pid" "$worker_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
}
trap shutdown EXIT INT TERM

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$worker_pid" 2>/dev/null; do
  sleep 1
done

status=0
if ! kill -0 "$worker_pid" 2>/dev/null; then
  wait "$worker_pid" || status=$?
  echo "editor export worker exited with status $status" >&2
else
  wait "$api_pid" || status=$?
fi
exit "$status"
