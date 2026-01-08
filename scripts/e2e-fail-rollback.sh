#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$BACKEND_DIR/../.." && pwd)"

API_BASE="${API_BASE:-http://127.0.0.1:3000/api/v1}"
SERVER_NAME="${SERVER_NAME:-example1.com}"
NGINX_PREFIX="${NGINX_PREFIX:-/usr/local/nginx}"
HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"
RUNTIME_DIR="$BACKEND_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/backend.pid"
LOG_FILE="$RUNTIME_DIR/backend.log"
WRAPPER="$RUNTIME_DIR/nginx-fail-wrapper.sh"

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

prepare_wrapper() {
  mkdir -p "$RUNTIME_DIR"
  cat > "$WRAPPER" <<'EOF'
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
EOF
  chmod +x "$WRAPPER"
}

start_backend() {
  mkdir -p "$RUNTIME_DIR"
  stop_backend
  prepare_wrapper
  (cd "$BACKEND_DIR" && NGINX_BIN="$WRAPPER" nohup pnpm start > "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE")
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

publish_should_fail() {
  local token="$1"
  local payload
  payload=$(cat <<'JSON'
{
  "actor": "e2e",
  "note": "fail-rollback",
  "dryRun": false,
  "enabledCoreRules": [],
  "enabledTemplates": [],
  "rules": [
    {
      "id": 9901,
      "target": "URI",
      "match": "CONTAINS",
      "pattern": "/waf-e2e-fail",
      "action": "DENY"
    }
  ]
}
JSON
)

  local resp_file="$RUNTIME_DIR/fail-rollback.json"
  curl -fsS "$API_BASE/servers/$SERVER_NAME/publish" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d "$payload" > "$resp_file"

  node -e '
const fs=require("fs");
const raw=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const data=raw?.data || raw;
if(data.status!=="FAILED"){
  console.error("expect FAILED status");
  process.exit(1);
}
const steps = data.steps || [];
const rollback = data.rollbackSteps || [];
if(!steps.find(s=>s.key==="nginxTest" && s.status==="FAILED")){
  console.error("missing nginxTest FAILED step");
  process.exit(1);
}
if(!rollback.find(s=>s.key==="restoreNginxConf")){
  console.error("missing restoreNginxConf rollback step");
  process.exit(1);
}
console.log("fail rollback ok");
' "$resp_file"
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
  publish_should_fail "$token"
  if [[ "$STOP_BACKEND_AFTER" == "1" ]]; then
    stop_backend
  fi
  echo "e2e fail rollback done"
}

main "$@"
