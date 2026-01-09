#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$BACKEND_DIR/../.." && pwd)"

API_BASE="${API_BASE:-http://127.0.0.1:3000/api/v1}"
NGINX_PREFIX="${NGINX_PREFIX:-/usr/local/nginx}"
HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"
NGINX_TEST_URL="${NGINX_TEST_URL:-http://127.0.0.1:8080}"
RUNTIME_DIR="$BACKEND_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/backend.pid"
LOG_FILE="$RUNTIME_DIR/backend.log"

CREATE_DB="${CREATE_DB:-0}"
STOP_BACKEND_AFTER="${STOP_BACKEND_AFTER:-1}"
SKIP_LOKI="${SKIP_LOKI:-0}"

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

load_loki_env() {
  if [[ -z "${LOKI_URL:-}" && -f "$BACKEND_DIR/.env" ]]; then
    LOKI_URL="$(rg -n "^LOKI_URL=" -m1 "$BACKEND_DIR/.env" | cut -d= -f2-)"
    export LOKI_URL
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

trigger_attack() {
  curl -s -o /dev/null -H "Host: example1.com" "$NGINX_TEST_URL/waf-loki-live"
}

query_loki() {
  local token="$1"
  local endpoint="$2"
  local query="$3"
  local expect="$4"
  local safe_endpoint="${endpoint//\//_}"
  local resp_file="$RUNTIME_DIR/loki-$safe_endpoint.json"
  local resp
  resp="$(
    curl -s -w '\n%{http_code}' "$API_BASE/logs/loki/$endpoint?$query" \
      -H "Authorization: Bearer $token"
  )"
  local body
  local code
  body="$(printf '%s' "$resp" | sed '$d')"
  code="$(printf '%s' "$resp" | tail -n 1)"
  printf '%s' "$body" > "$resp_file"
  if [[ "$code" != "200" ]]; then
    echo "loki request failed ($endpoint): $body" >&2
    exit 1
  fi
  node -e '
const fs=require("fs");
const raw=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const payload=raw?.data ?? raw;
if(!payload){
  console.error("invalid loki response (empty)");
  process.exit(1);
}
const expect=process.argv[2];
if(expect === "logs"){
  if(!payload.resultType || !Array.isArray(payload.result)){
    console.error("invalid logs response shape");
    process.exit(1);
  }
  console.log("loki logs ok", payload.resultType);
}else if(expect === "wafStats" || expect === "accessStats"){
  if(!payload.summary){
    console.error("invalid stats response shape");
    process.exit(1);
  }
  console.log("loki stats ok");
}else if(expect === "timeseries"){
  if(typeof payload.intervalSeconds !== "number" || !Array.isArray(payload.points)){
    console.error("invalid timeseries response shape");
    process.exit(1);
  }
  console.log("loki timeseries ok");
}else if(expect === "geo"){
  if(!payload.mode || !payload.scope){
    console.error("invalid geo response shape");
    process.exit(1);
  }
  console.log("loki geo ok");
}else{
  console.log("loki ok");
}
' "$resp_file" "$expect"
}

main() {
  ensure_hosts
  ensure_env
  load_loki_env
  if [[ -z "${LOKI_URL:-}" ]]; then
    if [[ "$SKIP_LOKI" == "1" ]]; then
      echo "LOKI_URL not set, skip loki live test"
      exit 0
    fi
    echo "LOKI_URL is required for loki live test" >&2
    exit 1
  fi
  create_db
  deploy_templates
  run_migrations
  start_backend
  local token
  token="$(login_token)"
  trigger_attack
  sleep 2
  query_loki "$token" "waf/logs" "timeRange=5m&limit=20" "logs"
  query_loki "$token" "waf/stats" "timeRange=5m&limit=20" "wafStats"
  query_loki "$token" "access/stats" "timeRange=5m&limit=20" "accessStats"
  query_loki "$token" "access/timeseries" "timeRange=5m&limit=200" "timeseries"
  query_loki "$token" "geo/world" "timeRange=5m&limit=200&mode=visit" "geo"
  query_loki "$token" "geo/china" "timeRange=5m&limit=200&mode=block" "geo"
  if [[ "$STOP_BACKEND_AFTER" == "1" ]]; then
    stop_backend
  fi
  echo "e2e loki live done"
}

main "$@"
