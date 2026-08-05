#!/usr/bin/env bash
# Azure App Service (Linux) startup command.
# Serves the FastAPI app; the built React frontend is served by the app itself
# (see the static frontend section at the bottom of api/main.py).
set -e

# Azure injects the listening port via $PORT (default 8000 for Python images).
PORT="${PORT:-8000}"

gunicorn -w 2 -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:"$PORT" \
  --timeout 300 \
  --graceful-timeout 30 \
  api.main:app
