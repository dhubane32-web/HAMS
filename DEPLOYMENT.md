# Hawana Airways Management System (HAMS) — production deployment

**Live architecture (hawanaairways.com):** see **`docs/PRODUCTION_HAWANA_AIRWAYS.md`** — Namecheap DNS, SSL, `hawanaairways.com` + `hams.hawanaairways.com` + `api.hawanaairways.com`, staging split, backups, monitoring, and safe migrations.

**Go-live checklist:** **`docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`**

This repository contains:

- **`frontend/`** — Next.js 14 traveler-facing homepage plus the authenticated operational workspace (routes under `(protected)` require sign-in via middleware).
- **`backend/`** — Express API (PostgreSQL, JWT sessions, RBAC enforced per route).

## 1. DNS and TLS (fixes SSL warnings and mixed content)

**Hawana `hams` + `api` subdomains only (cPanel / CNAME values / NXDOMAIN):** **`docs/DNS_HAMS_AND_API.md`** · Verify: **`bash scripts/verify-hawana-production-dns.sh`**

**Vercel `404: DEPLOYMENT_NOT_FOUND` on `hams.hawanaairways.com`:** **`docs/VERCEL_HAMS_DOMAIN.md`** (domain must be on the HAMS project with **Root Directory** `frontend`).

1. Point **A / AAAA** (or **CNAME** for PaaS) for your apex domain (e.g. `hawana.aero`) at your frontend host’s target (e.g. Vercel apex, VPS IP).
2. Add **`www`** as either a duplicate record or **CNAME** → apex. The Next.js config redirects `www` → apex when **`NEXT_PUBLIC_CANONICAL_HOST`** matches your apex hostname at **build time**.
3. Provision a trusted certificate (**Let’s Encrypt**, **Cloudflare Full (strict)**, **Vercel automatic SSL**, or **cPanel AutoSSL**). Avoid “Flexible” SSL that terminates HTTPS only at the edge while origin is plain HTTP—you will see warnings or downgrade attacks.
4. Ensure **`NEXT_PUBLIC_API_URL`** uses **`https://...`** matching a valid backend certificate. Mixed HTTP API from an HTTPS site causes browser blocking.
5. In Cloudflare/Vercel, enable **HTTPS redirect** once origin is trustworthy. Middleware also redirects when `x-forwarded-proto: http` is present in **`NODE_ENV=production`**.

## 2. Environment variables

### Frontend (`frontend/` → hosting env + rebuild)

| Variable | Required | Purpose |
|---------|----------|---------|
| `NEXT_PUBLIC_API_URL` | Yes | Public API origin, e.g. `https://api.hawana.aero` |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Canonical site URL `https://hawana.aero` |
| `NEXT_PUBLIC_CANONICAL_HOST` | Recommended | Apex hostname only, e.g. `hawana.aero` (enables www → apex redirect rules) |
| `NEXT_PUBLIC_BACKOFFICE_LOGIN_URL` | Optional | Full URL when login is hosted elsewhere |

### Backend (`backend/` → process env only, never prefixed with `NEXT_PUBLIC`)

| Variable | Production |
|----------|------------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://...` |
| `JWT_SECRET` | ≥ 32 chars |
| `HAMS_ENCRYPTION_KEY` | ≥ 32 chars |
| `FRONTEND_URL` | Browser origins comma-list, include your public Next.js origin(s), e.g. `https://hawana.aero` |
| `PORT` | Listening port |

Optional hardening:

- **`ADMIN_IP_ALLOWLIST`** — Restrict ` /api/system* ` to known IPs/CIDRs.
- **`HAMS_HTTPONLY_SESSION=true`** — When combined with SameSite cookies + credentialed fetch (see frontend auth API).

Secrets must never be shipped in `.env*` files committed to Git; rotate any keys that appeared in demos or snapshots.

## 3. Typical host setups

### Vercel (frontend only)

1. Import the **`frontend`** directory as project root (or monorepo with root set to `frontend`).
2. Set env vars from the frontend table above; trigger production deploy each time **`NEXT_PUBLIC_*`** changes (they embed at **build time**).
3. Deploy **`backend`** on Render / Fly.io / VPS; set **`FRONTEND_URL`** there to your deployed Next origin(s).

### cPanel / static + Node elsewhere

Export **`npm run build`** and **`npm run start`** (Node 18+) for Next, **or** use `standalone` output if you customize `next.config`; point the subdomain or document root per your hosting guide. Run the API as a managed Node app or under Phusion/PM2 with reverse proxy HTTPS.

### Replit / Glitch-style

Use **Secrets** UI for backend keys; frontend **public** URLs go in Repl secrets as `NEXT_PUBLIC_*`. Prefer **always-on** Repl for WS/long-running APIs.

### VPS (raw)

Nginx/Caddy terminates TLS → reverse proxy **`127.0.0.1:3000`** (Next) and **`127.0.0.1:5013`** (API). Proxy headers: **`X-Forwarded-Proto`** and **`X-Forwarded-Host`**.

### Split public vs back office

If travelers only hit the public site while staff uses a separate subdomain (e.g. `office.hawana.aero`), deploy Next twice:

- Traveller deployment: **`NEXT_PUBLIC_BACKOFFICE_LOGIN_URL=https://office.hawana.aero/login`**
- Office deployment: same codebase; omit or redirect `/` to `/login`. Ensure **`FRONTEND_URL`** lists **both** origins on the backend.

## 4. Production checks

Run locally before shipping:

```bash
cd frontend && NODE_ENV=production npm run build && npm run start
cd backend && NODE_ENV=production node src/index.js
```

Smoke test:

- **`/`** — Public marketing homepage (guests).
- **`/login`** — Staff sign-in; no default credentials prefilled (rotate any seed/demo accounts immediately).
- Any **`/dashboard`**… URL without session redirects to **`/login?next=`…**.

## 5. Operational security recap

API routes gate data with JWT + RBAC (`backend/src`). System routes add **`ADMIN_IP_ALLOWLIST`** when exposing admin APIs. Frontend does **not** define server-side database credentials—it only reaches the API URL you expose.

## 6. Continuous updates after launch (Git, staging, migrations, backups)

HAMS is meant to **keep changing** after the first production deploy. See **`docs/CONTINUOUS_DEPLOYMENT.md`** for:

- Git / Replit / Cursor workflow and branch strategy  
- **Staging vs production** environments and secrets  
- **Safe, repeatable database migrations** (`database/migrations/`, `backend/scripts/apply-pending-migrations.sh`)  
- **Backups** before major schema changes  
- Testing and release discipline without resetting production data  
