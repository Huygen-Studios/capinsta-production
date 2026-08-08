#!/bin/sh
set -eu

runtime="${WEB_JS_RUNTIME:-node}"

echo "capinsta_web_start cwd=$(pwd) user=$(id -u):$(id -g) port=${PORT:-3000} hostname=${HOSTNAME:-0.0.0.0}"
echo "capinsta_web_start server.js candidates:"
find /app -maxdepth 6 -type f -name server.js -print || true
echo "capinsta_web_start static directories:"
find /app -maxdepth 7 -type d -path "*/.next/static" -print || true
echo "capinsta_web_start public directories:"
find /app -maxdepth 6 -type d -name public -print || true

for server in /app/apps/web/server.js /app/server.js /app/apps/web/apps/web/server.js; do
  if [ -f "$server" ]; then
    echo "capinsta_web_start executing $runtime $server"
    exec "$runtime" "$server"
  fi
done

if [ -d /app/apps/web/.next ]; then
  echo "capinsta_web_start executing $runtime /app/apps/web/node_modules/next/dist/bin/next start"
  cd /app/apps/web
  exec "$runtime" /app/apps/web/node_modules/next/dist/bin/next start
fi

echo "capinsta_web_start no Next production build found" >&2
exit 1
