#!/bin/sh
set -eu

root="${LEGACY_CAPTION_STORAGE_ROOT:-/app/storage/legacy-caption}"
db_path="${DB_PATH:-${TEMP_DIR:-/tmp/huygen-caps}/database.sqlite}"
db_parent="$(dirname "$db_path")"
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
  "$db_parent"
for path in "$root" "${TEMP_DIR:-$root/tmp}" "${UPLOAD_DIR:-$root/uploads}" "${MEDIA_DIR:-$root/media}" "${EXPORT_DIR:-$root/exports}" "${CACHE_DIR:-$root/cache}" "$db_parent"; do
  case "$path" in
    /app/storage|/app/storage/*|/tmp/huygen-caps|/tmp/huygen-caps/*) chown -R capinsta:capinsta "$path" ;;
    *) echo "refusing to chown unmanaged storage path: $path" >&2; exit 1 ;;
  esac
done

exec gosu capinsta "$@"
