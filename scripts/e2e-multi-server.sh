#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$BACKEND_DIR/../.." && pwd)"

API_BASE="${API_BASE:-http://127.0.0.1:3000/api/v1}"
NGINX_PREFIX="${NGINX_PREFIX:-/usr/local/nginx}"
HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"
ACCESS_LOG="${ACCESS_LOG:-$NGINX_PREFIX/logs/access_waf.jsonl}"
NGINX_TEST_URL="${NGINX_TEST_URL:-http://127.0.0.1:8080}"
RUNTIME_DIR="$BACKEND_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/backend.pid"
LOG_FILE="$RUNTIME_DIR/backend.log"

CREATE_DB="${CREATE_DB:-0}"
STOP_BACKEND_AFTER="${STOP_BACKEND_AFTER:-1}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

require_cmd curl
require_cmd pnpm
require_cmd node

ensure_hosts() {
  if ! rg -q "example1\\.com|example2\\.com" "$HOSTS_FILE"; then
    printf '\n# WAF local test domains\n127.0.0.1 example1.com example2.com\n' | tee -a "$HOSTS_FILE" >/dev/null
  fi
}

ensure_env() {
  if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  fi
}

create_db() {
  if [[ "$CREATE_DB" != "1" ]]; then
    return 0
  fi
  require_cmd sudo
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waf_user') THEN
    CREATE ROLE waf_user LOGIN PASSWORD 'waf_pass';
  END IF;
END $$;

ALTER ROLE waf_user WITH LOGIN PASSWORD 'waf_pass';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'waf_control') THEN
    CREATE DATABASE waf_control OWNER waf_user;
  END IF;
END $$;

GRANT ALL PRIVILEGES ON DATABASE waf_control TO waf_user;
SQL
}

run_migrations() {
  (cd "$BACKEND_DIR" && pnpm migration:run)
}

deploy_templates() {
  bash "$ROOT_DIR/scripts/deploy-nginx-templates.sh" --yes
}

stop_backend() {
  if [[ -f "$PID_FILE" ]]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
  fi
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -t -iTCP:3000 -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      kill $pids 2>/dev/null || true
    fi
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k 3000/tcp 2>/dev/null || true
  fi
}

start_backend() {
  mkdir -p "$RUNTIME_DIR"
  stop_backend
  (cd "$BACKEND_DIR" && nohup pnpm start > "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE")
  for _ in {1..40}; do
    if curl -fsS "$API_BASE/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "backend health check failed, see $LOG_FILE" >&2
  exit 1
}

login_token() {
  curl -fsS "$API_BASE/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin"}' | \
    node -e '
const fs=require("fs");
const data=JSON.parse(fs.readFileSync(0,"utf8"));
const token = data?.data?.accessToken || data?.accessToken;
if (!token) {
  console.error("cannot parse accessToken");
  process.exit(1);
}
console.log(token);
'
}

publish_policy() {
  local token="$1"
  local server="$2"
  local rule_id="$3"
  local pattern="$4"
  local payload
  payload=$(cat <<JSON
{
  "actor": "e2e",
  "note": "multi-server",
  "dryRun": false,
  "enabledCoreRules": [],
  "enabledTemplates": [],
  "rules": [
    {
      "id": $rule_id,
      "target": "URI",
      "match": "CONTAINS",
      "pattern": "$pattern",
      "action": "DENY"
    }
  ]
}
JSON
)
  local resp_file="$RUNTIME_DIR/publish-$server.json"
  curl -fsS "$API_BASE/servers/$server/publish" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d "$payload" > "$resp_file"
  node -e '
const fs=require("fs");
const raw=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const data=raw?.data || raw;
if(data.status!=="SUCCESS"){
  console.error("publish failed", data);
  process.exit(1);
}
console.log("publish ok", data.version);
' "$resp_file"
}

hit_and_verify() {
  local host="$1"
  local path="$2"
  local rule_id="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $host" "$NGINX_TEST_URL$path")
  if [[ "$code" != "403" ]]; then
    echo "expect 403 for $host$path, got $code" >&2
    exit 1
  fi
  sleep 0.5
  if ! rg -q "\"waf_rule\":\"$rule_id\"" "$ACCESS_LOG"; then
    echo "missing waf_rule=$rule_id in access log" >&2
    exit 1
  fi
  if ! rg -q "\"host\":\"$host\"" "$ACCESS_LOG"; then
    echo "missing host=$host in access log" >&2
    exit 1
  fi
}

main() {
  ensure_hosts
  ensure_env
  create_db
  deploy_templates
  run_migrations
  start_backend
  local token
  token="$(login_token)"
  publish_policy "$token" "example1.com" 9101 "/waf-e2e-1"
  publish_policy "$token" "example2.com" 9102 "/waf-e2e-2"
  hit_and_verify "example1.com" "/waf-e2e-1" "9101"
  hit_and_verify "example2.com" "/waf-e2e-2" "9102"
  if [[ "$STOP_BACKEND_AFTER" == "1" ]]; then
    stop_backend
  fi
  echo "e2e multi server done"
}

main "$@"
