#!/bin/sh
set -eu

root="${LEGACY_CAPTION_STORAGE_ROOT:-/app/storage/legacy-caption}"
mkdir -p \
  "$root/tmp" \
  "$root/uploads" \
  "$root/media" \
  "$root/exports" \
  "$root/cache"
chown -R capinsta:capinsta "$root"

exec gosu capinsta "$@"
