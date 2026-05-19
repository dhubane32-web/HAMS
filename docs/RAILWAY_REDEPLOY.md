# Railway backend — full redeploy & schema sync

## Problem

Vercel frontend is current, but Railway may still run an **old Docker image** built from `backend/` only (no `database/`, no `/api/commercial`, no `/health/live`).

## Fix (one-time dashboard)

1. [railway.app](https://railway.app) → **hams-backend** service  
2. **Settings → Source**  
   - **Root Directory:** `/` (repository root, **not** `backend`)  
   - **Dockerfile path:** `Dockerfile` (repo root)  
3. **Settings → Variables** (Production)  
   - `DATABASE_URL` — from Postgres plugin  
   - `JWT_SECRET`, `HAMS_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY` (≥32 chars)  
   - `FRONTEND_URL=https://hams.hawanaairways.com,https://hams-frontend.vercel.app`  
   - `NODE_ENV=production`  
4. **Deployments → Redeploy** (enable **Clear build cache** if offered)  
5. Wait until health check passes (`/health/live`)

## Schema sync (from your laptop)

```bash
export DATABASE_URL='postgresql://…'   # Railway Postgres → Connect
bash scripts/sync-railway-production.sh
# Optional demo data:
SEED_DEMO=1 bash scripts/sync-railway-production.sh
```

## Verify API

```bash
API_BASE=https://hams-backend-production.up.railway.app \
EMAIL=admin@hawanaairways.com \
PASSWORD='your-password' \
bash scripts/verify-railway-production.sh
```

Through Vercel proxy:

```bash
FRONTEND=https://hams.hawanaairways.com \
EMAIL=admin@hawanaairways.com \
PASSWORD='…' \
bash scripts/verify-production-enterprise-ops.sh
```

## Auto-migrations on boot

New images run `backend/docker-entrypoint.sh`, which applies pending migrations before `node src/index.js`.

Disable with: `HAMS_RUN_MIGRATIONS_ON_START=false`

## Vercel

Ensure **Production** has:

- `HAMS_BACKEND_INTERNAL_URL=https://<your-railway-service>.up.railway.app`  
- `NEXT_PUBLIC_USE_API_PROXY=true`  
- `NEXT_PUBLIC_API_URL=/api`

Redeploy Vercel after Railway is healthy.
