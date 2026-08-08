#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR"
BACKEND_PORT=8000
FRONTEND_PORT=5173

kill_port() {
  local port=$1
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids=$(lsof -ti tcp:"$port" || true)
    if [[ -n "$pids" ]]; then
      echo "Stopping existing process(es) on port $port: $pids"
      kill $pids || true
      sleep 1
    fi
  fi
}

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not on PATH. Please install Node.js/npm first."
  exit 1
fi

kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

echo "Starting backend on port $BACKEND_PORT..."
cd "$BACKEND_DIR"

backend_log="$ROOT_DIR/backend.log"
frontend_log="$ROOT_DIR/frontend.log"

if [[ -f "$ROOT_DIR/.venv/bin/activate" ]]; then
  # shellcheck source=/dev/null
  source "$ROOT_DIR/.venv/bin/activate"
fi

nohup "$ROOT_DIR/.venv/bin/python" -m uvicorn api.main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT" > "$backend_log" 2>&1 &
backend_pid=$!

echo "Starting frontend on port $FRONTEND_PORT..."
cd "$FRONTEND_DIR"
nohup npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" > "$frontend_log" 2>&1 &
frontend_pid=$!

echo "Backend PID: $backend_pid"
echo "Frontend PID: $frontend_pid"
echo "Logs: $backend_log, $frontend_log"

echo "Frontend is available at: http://127.0.0.1:$FRONTEND_PORT"
echo "Backend is available at: http://127.0.0.1:$BACKEND_PORT"
echo "Services started. Use the above PIDs to stop them if needed."