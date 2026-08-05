# Deploy to Azure (App Service) — Step-by-Step

This guide takes you from **zero** (no Azure account) to a **public dashboard link**
you can share with your client — e.g. `https://inventory-dashboard.azurewebsites.net`.

**Architecture:** one Azure App Service (Linux) hosts **both** the FastAPI backend and
the built React frontend. Your client gets a single HTTPS URL. No CORS, no second
service, minimal cost.

```
Browser ──HTTPS──▶ https://<app>.azurewebsites.net
                        │
                        ├── /           → React dashboard (frontend/dist)
                        ├── /process    → FastAPI API (api/main.py)
                        ├── /sheets     → FastAPI API
                        └── /download   → FastAPI API
```

---

## Prerequisites (only needed once)

### 1. Install the Azure CLI

| OS | Command |
|----|---------|
| macOS | `brew install azure-cli` |
| Windows | Download installer: <https://aka.ms/installazurecliwindows> |
| Linux | `curl -sL https://aka.ms/InstallAzureCli | bash` |

Verify: `az --version`

### 2. Create a free Azure account

Go to <https://azure.microsoft.com/free/> → **Start free**. You get:

- **$200 free credit** for 30 days (plenty for this project)
- Access to **free-tier** services after that

> A payment card is required to sign up (even on the free plan) — Azure uses it to
> verify identity and bill only if you exceed free allowances. You will **not** be
> charged for the F1 free tier.

### 3. Log in

```bash
az login
```

A browser opens → sign in with your Azure account.

---

## One-time Azure setup (create the App Service)

Pick a **globally unique** app name (this becomes part of your client link):

```bash
# Adjust if you want a different region (southindia / centralindia are near India)
az group create --name inventory-rg --location southindia

# Create the App Service plan + web app
#   F1 = Free tier (₹0) — fine for testing
#   B1 = Basic (≈₹700–1,000/mo) — always-on, use before sharing with the client
az appservice plan create \
  --name inventory-plan \
  --resource-group inventory-rg \
  --sku F1 \
  --is-linux

az webapp create \
  --resource-group inventory-rg \
  --plan inventory-plan \
  --name <YOUR-UNIQUE-APP-NAME> \
  --runtime "PYTHON:3.12"
```

### Configure the app

```bash
APP=<YOUR-UNIQUE-APP-NAME>

# Tell Azure to install Python deps from requirements.txt on each deploy
az webapp config appsettings set \
  --resource-group inventory-rg --name "$APP" \
  --settings SCM_DO_BUILD_DURING_DEPLOYMENT=true

# Point the app at our startup script (gunicorn + uvicorn on the injected $PORT)
az webapp config set \
  --resource-group inventory-rg --name "$APP" \
  --startup-file "startup.sh"
```

> **Free tier (F1) notes:** the app *sleeps* after ~20 min of no traffic and takes
> ~30–60 s to cold-start on the first visit. Perfect for you to test. Before sending
> the link to the client, upgrade to **B1** so the dashboard is always warm:
>
> ```bash
> az appservice plan update --name inventory-plan \
>   --resource-group inventory-rg --sku B1
> ```

---

## Deploy the app

The repo includes `deploy.sh` which builds the frontend and zips the app for you:

```bash
./deploy.sh <YOUR-UNIQUE-APP-NAME> inventory-rg
```

This runs:

1. `npm ci && npm run build` in `frontend/` (produces `frontend/dist`)
2. Zips `api/`, `backend/`, `frontend/dist`, `requirements.txt`, `startup.sh`
3. `az webapp deploy` pushes it to Azure
4. Azure installs Python deps (via Oryx build) and runs `startup.sh`

First deploy takes **2–4 minutes** (deps install + app restart). Subsequent deploys
are faster.

### Manual alternative (no script)

```bash
cd frontend && npm ci && npm run build && cd ..
zip -r deploy.zip api backend frontend/dist requirements.txt startup.sh
az webapp deploy --resource-group inventory-rg --name <APP> --src-path deploy.zip --type zip
```

---

## Your client link

```
https://<YOUR-UNIQUE-APP-NAME>.azurewebsites.net
```

Test it yourself first:

- The dashboard loads (Overview page) ✔
- Upload an Order Intake workbook → Run Analysis works end-to-end ✔
- `https://<APP>.azurewebsites.net/health` returns `{"status":"ok"}` ✔
- `https://<APP>.azurewebsites.net/docs` shows the Swagger API docs ✔

> If a previous workbook was uploaded, the backend keeps it in a disk cache
> (`/tmp/rol_pipeline_cache` — wiped on restart), so the client can re-upload
> fresh data any time. Uploaded data never leaves the app's storage.

---

## Updating the app (new code / fixes)

Just re-run the deploy — the same link keeps working:

```bash
./deploy.sh <YOUR-UNIQUE-APP-NAME> inventory-rg
```

---

## Security (before sharing with the client)

By default the link is public with **no login**. Azure App Service supports easy
built-in auth so only people you invite can open the dashboard:

```bash
# Example: add Microsoft Entra ID (Azure AD) login to the app
az webapp auth update \
  --resource-group inventory-rg \
  --name "$APP" \
  --enabled true \
  --action AllowAnonymous   # or RedirectToLoginPage to force login
```

Options:
- **Force login** (recommended for client data): set `--action RedirectToLoginPage`
- **No login** (quick demo): fine for a short demo, but anyone with the link can open it
- Also consider **HTTPS-only** (already default for App Service) and disabling the
  `FTP`/`SCM` endpoints if you don't need them.

> ⚠️ The dashboard lets users upload Excel files and download results. For a
> production client deployment, **add authentication before sharing the link**.

---

## Cost estimate

| Tier | Monthly cost (approx.) | Notes |
|------|------------------------|-------|
| F1 (Free) | ₹0 | Sleeps after ~20 min idle; slow cold start |
| B1 (Basic) | ₹700–1,000 | Always-on, 1.75 GB RAM, 1 CPU — recommended for client demo |
| B2 (Basic) | ₹1,400–2,000 | 2 CPU / 3.5 GB RAM — if the workbook is large |

The **$200 free credit** covers several months of B1 if you upgrade during the first
30 days.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `503 Service Unavailable` after deploy | App still restarting — wait 1–2 min, then refresh |
| `Application Error` / splash screen | Check logs: `az webapp log tail --resource-group inventory-rg --name <APP>` |
| `ModuleNotFoundError` | Confirm `SCM_DO_BUILD_DURING_DEPLOYMENT=true` is set, and `requirements.txt` is in the zip root |
| `TypeError: FastAPI.__call__() missing...` | Startup file must use `-k uvicorn.workers.UvicornWorker` (already in `startup.sh`) |
| React route 404s on refresh | The SPA catch-all in `api/main.py` must be the **last** route (it is — don't move it) |
| API calls fail on the deployed site | You shouldn't need `VITE_API_BASE_URL` — in production the frontend calls the API on the same origin (relative URLs). Only set it if the API moves to a different host. |
| Deploy succeeds but old data shows | Disk cache is stored in `/tmp` and cleared on restart — upload a fresh workbook after deploy |
| 500 on large uploads | App Service default request limit is fine for Excel, but huge workbooks may hit memory limits on F1 — upgrade to B1+ |

---

## Optional: automate deploys with GitHub Actions

If the code lives in a Git repo, you can auto-deploy on every `git push`:

```yaml
# .github/workflows/azure-deploy.yml
name: Deploy to Azure

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: cd frontend && npm ci && npm run build
      - run: zip -r deploy.zip api backend frontend/dist requirements.txt startup.sh
      - uses: azure/webapps-deploy@v3
        with:
          app-name: <YOUR-UNIQUE-APP-NAME>
          publish-profile: ${{ secrets.AZURE_PUBLISH_PROFILE }}
          package: deploy.zip
```

(Get the publish profile from Azure Portal → your App Service → **Overview** →
**Get publish profile**, then save it as the `AZURE_PUBLISH_PROFILE` secret.)
