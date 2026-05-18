# Production auth fix — API not reachable

## Diagnosis (verified)

| Check | Result |
|-------|--------|
| `https://hams-frontend.vercel.app` | Frontend loads (Vercel) |
| `https://api.hawanaairways.com/health` | **Fails — DNS does not resolve** (`Could not resolve host`) |

The login error **“Unable to reach the authentication service”** happens because the browser calls  
`NEXT_PUBLIC_API_URL` (default `https://api.hawanaairways.com`) and **there is no live API at that hostname**.

**Code/CORS changes alone cannot fix this until a backend is deployed and reachable.**

---

## Path A — Deploy API + DNS (recommended long-term)

1. **Deploy** the `backend/` service (Dockerfile included) to Railway, Render, Fly, or a VPS.
2. **Namecheap/cPanel DNS** — add record for **`api`**:
   - **CNAME** → your host (e.g. Railway) **or**
   - **A** → server IPv4
3. On the API host set **production env**:
   - `DATABASE_URL`, `JWT_SECRET` (≥32), `HAMS_ENCRYPTION_KEY` (≥32)
   - `FRONTEND_URL=https://hams-frontend.vercel.app,https://hams.hawanaairways.com`
   - `PORT=5013` (or host default)
4. Reset admin password on **production DB**:
   ```bash
   DATABASE_URL='postgresql://...' node backend/scripts/reset-hawana-admin-password.mjs
   ```
5. **Vercel frontend** env:
   - `NEXT_PUBLIC_API_URL=https://api.hawanaairways.com`
   - `NEXT_PUBLIC_USE_API_PROXY` = unset or `false`
6. Verify:
   ```bash
   curl -sS https://api.hawanaairways.com/health
   curl -sS -X POST https://api.hawanaairways.com/api/auth/login \
     -H 'Content-Type: application/json' \
     -H 'Origin: https://hams-frontend.vercel.app' \
     -d '{"email":"admin@hawanaairways.com","password":"Hawana@2026"}'
   ```
7. **Redeploy** frontend; test `https://hams-frontend.vercel.app/login`.

---

## Path B — QUICK FIX (Railway API + Vercel proxy) — use now

**Automated script (after `railway login`):**

```bash
chmod +x scripts/path-b-deploy-railway-vercel.sh
bash scripts/path-b-deploy-railway-vercel.sh
```

**Manual checklist:**

| Step | Action |
|------|--------|
| 1 | [Railway](https://railway.app) → **New Project** → **Deploy from GitHub** → repo `dhubane32-web/HAMS`, set **Root Directory** = `backend` (or deploy with Dockerfile in `backend/`) |
| 2 | Railway **Variables**: `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `HAMS_ENCRYPTION_KEY` (≥32), `NODE_ENV=production`, `FRONTEND_URL=https://hams-frontend.vercel.app` |
| 3 | Railway → **Networking** → **Generate domain** → copy URL e.g. `https://hams-api-production.up.railway.app` |
| 4 | Run password reset against Railway Postgres: `DATABASE_URL='...' node backend/scripts/reset-hawana-admin-password.mjs` |
| 5 | Vercel → HAMS frontend project → **Environment Variables** (Production): see table below — **dashboard only:** **`docs/VERCEL_DASHBOARD_PATH_B.md`** |
| 6 | Vercel → **Redeploy** with **Clear build cache** (no CLI) |
| 7 | Test `https://hams-frontend.vercel.app/login` |

**Vercel Production env:**

| Name | Value |
|------|--------|
| `HAMS_BACKEND_INTERNAL_URL` | `https://YOUR-SERVICE.up.railway.app` |
| `NEXT_PUBLIC_USE_API_PROXY` | `true` |
| `NEXT_PUBLIC_API_URL` | `/api` |
| `NEXT_PUBLIC_SITE_URL` | `https://hams-frontend.vercel.app` |
| `NEXT_PUBLIC_CANONICAL_HOST` | `hams-frontend.vercel.app` |

**Verify:**

```bash
curl -sS https://YOUR-SERVICE.up.railway.app/health
curl -sS https://hams-frontend.vercel.app/health
curl -sS -X POST https://hams-frontend.vercel.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@hawanaairways.com","password":"Hawana@2026"}'
```

---

## Path B — API proxy via Vercel frontend (until `api.` DNS exists)

Use when the API runs on a **temporary URL** (e.g. `https://hams-api.up.railway.app`) but `api.hawanaairways.com` is not ready.

1. Deploy **backend** to Railway/Render; note the public URL, e.g. `https://hams-api-production.up.railway.app`.
2. On the **HAMS frontend** Vercel project → **Environment Variables** (Production):

   | Name | Value |
   |------|--------|
   | `HAMS_BACKEND_INTERNAL_URL` | `https://hams-api-production.up.railway.app` (your real API URL) |
   | `NEXT_PUBLIC_USE_API_PROXY` | `true` |
   | `NEXT_PUBLIC_API_URL` | leave empty or `/api` |
   | `NEXT_PUBLIC_SITE_URL` | `https://hams-frontend.vercel.app` |

3. **Redeploy** frontend (Clear build cache).
4. Browser calls `https://hams-frontend.vercel.app/api/auth/login` → Vercel rewrites to your Railway API.
5. On the **API** set `FRONTEND_URL` to include `https://hams-frontend.vercel.app` (CORS is also auto-allowed for `hams*.vercel.app`).

---

## Admin credentials

| Email | Password |
|-------|----------|
| `admin@hawanaairways.com` | `Hawana@2026` |

See **`docs/HAMS_ADMIN_LOGIN.md`**.

---

## CORS

The API allows:

- Origins in `FRONTEND_URL` and `HAMS_EXTRA_CORS_ORIGINS`
- `https://hams-frontend.vercel.app` and other `https://hams*.vercel.app` hosts automatically

Login route `POST /api/auth/login` is exempt from strict origin checks for mutations.
