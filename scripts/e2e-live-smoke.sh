#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3000/api/v1}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
SERVER_NAME="${SERVER_NAME:-example1.com}"
NGINX_TEST_URL="${NGINX_TEST_URL:-http://127.0.0.1:8080}"
NGINX_TEST_HOST="${NGINX_TEST_HOST:-$SERVER_NAME}"
LOG_DIR="${LOG_DIR:-/usr/local/nginx/logs}"
ATTACK_PATH="${ATTACK_PATH:-/waf-e2e}"
ATTACK_QUERY="${ATTACK_QUERY:-a=select%201}"
RULE_ID="${RULE_ID:-9001}"
RUN_LOKI="${RUN_LOKI:-0}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

require_cmd curl
require_cmd node

echo "== step 1: login"
login_json="$(
  curl -s -X POST "$API_BASE/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}"
)"
access_token="$(
  printf '%s' "$login_json" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const token = data?.data?.accessToken || data?.accessToken;
if (!token) {
  console.error("cannot parse accessToken");
  process.exit(1);
}
console.log(token);
'
)"

echo "== step 2: publish rule"
publish_payload="$(cat <<EOF
{
  "enabledCoreRules": [],
  "enabledTemplates": [],
  "rules": [
    {
      "id": ${RULE_ID},
      "target": "URI",
      "match": "CONTAINS",
      "pattern": "${ATTACK_PATH}",
      "action": "DENY"
    }
  ],
  "note": "e2e smoke",
  "dryRun": false
}
EOF
)"
publish_json="$(
  curl -s -X POST "$API_BASE/servers/$SERVER_NAME/publish" \
    -H "Authorization: Bearer $access_token" \
    -H 'Content-Type: application/json' \
    -d "$publish_payload"
)"
publish_status="$(
  printf '%s' "$publish_json" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const status = data?.data?.status || data?.status;
console.log(status || "UNKNOWN");
'
)"
echo "publish status: $publish_status"
if [ "$publish_status" != "SUCCESS" ]; then
  echo "publish failed: $publish_json" >&2
  exit 1
fi

echo "== step 3: attack request"
http_code="$(
  curl -s -o /dev/null -w '%{http_code}' \
    -H "Host: $NGINX_TEST_HOST" \
    "$NGINX_TEST_URL$ATTACK_PATH?$ATTACK_QUERY"
)"
echo "http status: $http_code"

echo "== step 4: log check"
tail -n 20 "$LOG_DIR/access_waf.jsonl" | grep -n "$NGINX_TEST_HOST" || true
tail -n 20 "$LOG_DIR/waf.jsonl" | grep -n '"attackType"' || true

if [ "$RUN_LOKI" = "1" ]; then
  echo "== step 5: loki query"
  curl -s -X GET "$API_BASE/logs/loki/waf/logs?timeRange=5m&limit=5" \
    -H "Authorization: Bearer $access_token" \
    -H 'Content-Type: application/json' | head -c 200 || true
  echo
fi

echo "done"
