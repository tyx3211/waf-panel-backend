#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$BACKEND_DIR/../.." && pwd)"

API_BASE="${API_BASE:-http://127.0.0.1:3000/api/v1}"
SERVER_NAME="${SERVER_NAME:-example1.com}"
NGINX_TEST_URL="${NGINX_TEST_URL:-http://127.0.0.1:8080}"
HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"
NGINX_PREFIX="${NGINX_PREFIX:-/usr/local/nginx}"
ACCESS_LOG="${ACCESS_LOG:-$NGINX_PREFIX/logs/access_waf.jsonl}"
AUDIT_LOG="${AUDIT_LOG:-$NGINX_PREFIX/logs/waf.jsonl}"
RUNTIME_DIR="$BACKEND_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/backend.pid"
LOG_FILE="$RUNTIME_DIR/backend.log"

CREATE_DB="${CREATE_DB:-0}"
STOP_BACKEND_AFTER="${STOP_BACKEND_AFTER:-0}"

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

run_smoke() {
  (cd "$BACKEND_DIR" && bash "$SCRIPT_DIR/e2e-live-smoke.sh")
}

verify_logs() {
  if [[ ! -f "$ACCESS_LOG" ]]; then
    echo "missing access log: $ACCESS_LOG" >&2
    exit 1
  fi
  rg -n "/waf-e2e" "$ACCESS_LOG" | tail -n 3 || true
  if ! rg -q "\"waf_rule\":\"9001\"" "$ACCESS_LOG"; then
    echo "waf_rule=9001 not found in access_waf.jsonl" >&2
    exit 1
  fi
  if [[ -f "$AUDIT_LOG" ]]; then
    rg -n "\"ruleId\":9001" "$AUDIT_LOG" | tail -n 3 || true
  fi
}

main() {
  ensure_hosts
  ensure_env
  create_db
  deploy_templates
  run_migrations
  start_backend
  run_smoke
  verify_logs
  if [[ "$STOP_BACKEND_AFTER" == "1" ]]; then
    stop_backend
  fi
  echo "e2e full done"
}

main "$@"
