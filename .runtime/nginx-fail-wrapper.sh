#!/usr/bin/env bash
set -euo pipefail

REAL_BIN="${REAL_NGINX_BIN:-/usr/local/nginx/sbin/nginx}"
for arg in "$@"; do
  if [[ "$arg" == "-t" ]]; then
    echo "nginx: [emerg] mock syntax error" >&2
    exit 1
  fi
done
exec "$REAL_BIN" "$@"
