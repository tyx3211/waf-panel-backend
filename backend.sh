#!/usr/bin/env bash
# 后端服务管理脚本
set -e

BACKEND_DIR="/home/william/myNginxWorkspace/web-control-panel/backend"
LOG_FILE="/tmp/backend.log"
PID_FILE="/tmp/backend.pid"

start() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
        echo "Backend is already running (PID: $(cat $PID_FILE))"
        return 1
    fi
    cd "$BACKEND_DIR"
    nohup node dist/main.js > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Backend started (PID: $!)"
    echo "Logs: $LOG_FILE"
}

stop() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID"
            rm -f "$PID_FILE"
            echo "Backend stopped (PID: $PID)"
        else
            rm -f "$PID_FILE"
            echo "Backend was not running (stale PID file removed)"
        fi
    else
        # 尝试通过端口查找
        PID=$(lsof -ti:3000 2>/dev/null || true)
        if [ -n "$PID" ]; then
            kill "$PID"
            echo "Backend stopped (PID: $PID, found by port)"
        else
            echo "Backend is not running"
        fi
    fi
}

restart() {
    stop
    sleep 1
    start
}

status() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
        echo "Backend is running (PID: $(cat $PID_FILE))"
    else
        PID=$(lsof -ti:3000 2>/dev/null || true)
        if [ -n "$PID" ]; then
            echo "Backend is running (PID: $PID, found by port)"
        else
            echo "Backend is not running"
        fi
    fi
}

logs() {
    tail -f "$LOG_FILE"
}

case "${1:-}" in
    start)   start ;;
    stop)    stop ;;
    restart) restart ;;
    status)  status ;;
    logs)    logs ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
