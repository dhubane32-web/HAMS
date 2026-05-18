# HAMS admin login (Hawana Airways)

## Default super-admin (after reset)

| Field | Value |
|-------|--------|
| **Email** | `admin@hawanaairways.com` |
| **Password** | `Hawana@2026` |

Reset anytime (local or server with `DATABASE_URL`):

```bash
node backend/scripts/reset-hawana-admin-password.mjs
# custom password:
node backend/scripts/reset-hawana-admin-password.mjs --password 'YourSecurePassword'
```

SQL seed: `database/auth_hawana_admin.sql`

---

## “Unable to reach the authentication service”

The login page calls **`NEXT_PUBLIC_API_URL`** + `/api/auth/login`. This error means the **browser could not complete the HTTP request** (API down, wrong URL, DNS, or TLS)—not a wrong password.

### Frontend (Vercel)

Set **Production** env on the HAMS Next.js project:

| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | `https://api.hawanaairways.com` |
| `NEXT_PUBLIC_SITE_URL` | `https://hams-frontend.vercel.app` or `https://hams.hawanaairways.com` |
| `NEXT_PUBLIC_CANONICAL_HOST` | matching host |

Redeploy after changing env vars.

### Backend (API host)

API must be running and reachable at that URL. **Production** requires:

- `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `HAMS_ENCRYPTION_KEY` (≥32 chars)
- `FRONTEND_URL` including every browser origin that calls the API, e.g.  
  `https://hams.hawanaairways.com,https://hams-frontend.vercel.app`

The API also allows **`hams*.vercel.app`** HTTPS origins automatically for Hawana Vercel projects. Optional: `HAMS_EXTRA_CORS_ORIGINS` for other preview URLs.

### Quick checks

```bash
curl -sS https://api.hawanaairways.com/health
curl -sS -X POST https://api.hawanaairways.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@hawanaairways.com","password":"Hawana@2026"}'
```

Expect `{"ok":true,...}` from `/health` and a JSON body with `token` from login.
