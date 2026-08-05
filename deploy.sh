#!/usr/bin/env bash
# One-shot Azure App Service deployment script.
#
#   ./deploy.sh <app-name> [resource-group]
#
# Builds the React frontend, then pushes the whole app (API + backend +
# frontend/dist) to an existing Azure App Service via a zip deploy. Requires:
#   - az CLI installed and logged in (az login)
#   - An App Service already created (see DEPLOY.md)
#   - SCM_DO_BUILD_DURING_DEPLOYMENT=true app setting so pip deps install
set -euo pipefail

APP_NAME="${1:?Usage: ./deploy.sh <app-name> [resource-group]}"
RESOURCE_GROUP="${2:-inventory-rg}"
ZIP_FILE="deploy-$(date +%Y%m%d-%H%M%S).zip"

echo "==> Building frontend (npm ci + build)…"
( cd frontend && npm ci && npm run build )

echo "==> Packing deploy.zip (api/, backend/, frontend/dist, requirements, startup)…"
# Exclude local caches, node_modules, .git, __pycache__ and other junk.
zip -r "$ZIP_FILE" \
  api backend frontend/dist requirements.txt startup.sh \
  -x "*__pycache__*" "*.pyc" "*.pyo" "*/.git/*" "*/node_modules/*" "*/.venv/*" "*/venv/*" "*rol_pipeline_cache*"

echo "==> Deploying to App Service '$APP_NAME' (rg: $RESOURCE_GROUP)…"
az webapp deploy \
  --resource-group "$RESOURCE_GROUP" \
  --name "$APP_NAME" \
  --src-path "$ZIP_FILE" \
  --type zip

rm -f "$ZIP_FILE"

echo "==> Done. Your dashboard is live at:"
echo "    https://$APP_NAME.azurewebsites.net"
echo "    (give Azure ~1–2 min after deploy to restart the app)"
