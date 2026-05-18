# Path B — Vercel dashboard only (no CLI)

Use this when the API runs on **Railway** and the frontend is **`hams-frontend.vercel.app`**. Do **not** use `vercel login` or CLI env commands.

---

## Prerequisites

1. **Railway backend is live** with a public URL, e.g. `https://your-service.up.railway.app`
2. `curl -sS https://your-service.up.railway.app/health` returns `{"ok":true,...}`
3. Admin password reset on **Railway Postgres** (not local DB):
   ```bash
   DATABASE_URL='postgresql://...' node backend/scripts/reset-hawana-admin-password.mjs
   ```

---

## 1. Open the HAMS frontend project

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Open the project that serves **`hams-frontend.vercel.app`**
3. Confirm **Settings → General → Root Directory** = **`frontend`**

---

## 2. Environment variables (Production)

**Settings → Environment Variables → Add** (scope: **Production** only):

| Name | Value |
|------|--------|
| `HAMS_BACKEND_INTERNAL_URL` | `https://YOUR-SERVICE.up.railway.app` (no trailing slash) |
| `NEXT_PUBLIC_USE_API_PROXY` | `true` |
| `NEXT_PUBLIC_API_URL` | `/api` (same-origin proxy — **not** the Railway hostname in the browser) |

**Alternative (direct to Railway, no Vercel proxy):** set `NEXT_PUBLIC_API_URL` to the Railway URL and `HAMS_BACKEND_INTERNAL_URL` to the same URL; ensure Railway `FRONTEND_URL` includes your Vercel/custom domains.
| `NEXT_PUBLIC_SITE_URL` | `https://hams.hawanaairways.com` (or `https://hams-frontend.vercel.app` if custom domain not ready) |

Optional:

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_CANONICAL_HOST` | `hams.hawanaairways.com` |

**Railway `FRONTEND_URL` (CORS):**  
`https://hams.hawanaairways.com,https://hams-frontend.vercel.app`

**Important:** `HAMS_BACKEND_INTERNAL_URL` must exist for **Production** before redeploy. The app proxies `/health` and `/api/*` at **runtime** via route handlers (and build-time rewrites when the var is present at build).

---

## 3. Redeploy with clear cache

1. **Deployments** tab
2. On the latest **Production** deployment → **⋯** menu → **Redeploy**
3. Enable **Clear build cache**
4. Confirm **Redeploy**

Wait until status is **Ready**.

---

## 4. Verify (browser or terminal)

```bash
# Should return JSON, not 307 to /login
curl -sS https://hams-frontend.vercel.app/health

curl -sS -X POST https://hams-frontend.vercel.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@hawanaairways.com","password":"Hawana@2026"}'
```

Browser:

1. [https://hams-frontend.vercel.app/login](https://hams-frontend.vercel.app/login)
2. Sign in → **Dashboard** loads, no “Unable to reach the authentication service”

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/health` → 307 to `/login` | Redeploy after pushing latest `frontend/middleware.ts` (skips auth for `/health` and `/api/*`) |
| `/health` → 404 HTML | `HAMS_BACKEND_INTERNAL_URL` missing/wrong at **build** time → set env, **Clear build cache**, redeploy |
| Login: connection error | Railway API down or wrong `HAMS_BACKEND_INTERNAL_URL` |
| Login: invalid credentials | Run password reset on **Railway** `DATABASE_URL`, not localhost |

---

## Railway dashboard (backend)

If you do not have a Railway URL yet:

1. [railway.app](https://railway.app) → project → service **backend**
2. **Variables:** `DATABASE_URL`, `JWT_SECRET`, `HAMS_ENCRYPTION_KEY`, `NODE_ENV=production`, `FRONTEND_URL=https://hams-frontend.vercel.app`
3. **Networking → Generate domain** → use that URL in `HAMS_BACKEND_INTERNAL_URL`

See **`docs/API_PRODUCTION_AUTH_FIX.md`** for full Path B details.
