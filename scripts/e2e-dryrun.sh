#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3000/api/v1}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
SERVER_NAME="${SERVER_NAME:-example1.com}"
RULE_ID="${RULE_ID:-9001}"

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

echo "== step 2: publish dryRun"
publish_payload="$(cat <<EOF
{
  "enabledCoreRules": [],
  "enabledTemplates": [],
  "rules": [
    {
      "id": ${RULE_ID},
      "target": "URI",
      "match": "CONTAINS",
      "pattern": "/waf-dryrun",
      "action": "DENY"
    }
  ],
  "note": "e2e dryRun",
  "dryRun": true
}
EOF
)"
publish_json="$(
  curl -s -X POST "$API_BASE/servers/$SERVER_NAME/publish" \
    -H "Authorization: Bearer $access_token" \
    -H 'Content-Type: application/json' \
    -d "$publish_payload"
)"

echo "== step 3: validate response"
printf '%s' "$publish_json" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const payload = data?.data || data;
if (payload?.status !== "SUCCESS") {
  console.error("publish dryRun failed:", JSON.stringify(payload));
  process.exit(1);
}
const steps = payload.steps || [];
const reload = steps.find((s) => s.key === "nginxReload");
if (!reload || reload.status !== "SKIPPED") {
  console.error("expected nginxReload SKIPPED in dryRun");
  process.exit(1);
}
console.log("dryRun ok");
'

echo "e2e dryRun done"
