# Hawana Airways HAMS — production architecture (hawanaairways.com)

**Operator checklist (cutover day):** **`docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`** — OCC verification, backups, deploy order, DNS, testing matrix, security.

This guide describes a **professional split-domain** layout for **Hawana Airways HAMS only** (no other brands or legacy stacks).

| Surface | URL | Role |
|---------|-----|------|
| **Public website** | `https://hawanaairways.com` | Traveler-facing Next.js home (`/`), marketing, “Staff sign-in” link to HAMS. |
| **HAMS operations** | `https://hams.hawanaairways.com` | Full staff workspace (sign-in, dashboard, OCC, finance, etc.). |
| **API (recommended)** | `https://api.hawanaairways.com` | Express backend (`/api/*`, `/health`). Keeps cookies/CORS clear and scales independently. |

Use **separate staging** hosts (examples): `https://staging.hawanaairways.com`, `https://hams-staging.hawanaairways.com`, `https://api-staging.hawanaairways.com` with **different** `DATABASE_URL` and secrets.

---

## 1. Namecheap DNS

**HAMS-only subdomains (`hams`, `api`), including cPanel targets and copy-paste CNAME values:**  
→ **`docs/DNS_HAMS_AND_API.md`**

After records exist, run **`bash scripts/verify-hawana-production-dns.sh`** (read-only DNS + HTTPS check).

You can keep **Namecheap as registrar** and still use enterprise-grade DNS/TLS (recommended: **Cloudflare** as DNS + proxy — see §3). If you stay on **Namecheap nameservers** only:

### Records (Namecheap → Advanced DNS)

| Type | Host | Value | TTL |
|------|------|-------|-----|
| **A** | `@` | Your **origin** IPv4 (VPS, or host IP from PaaS doc) | Automatic |
| **A** or **CNAME** | `www` | Same apex target, or CNAME to provider (if supported) | Automatic |
| **CNAME** or **A** | `hams` | See **`DNS_HAMS_AND_API.md`** (e.g. Vercel: `cname.vercel-dns.com`) | Automatic |
| **CNAME** or **A** | `api` | API origin hostname or IPv4 — see **`DNS_HAMS_AND_API.md`** | Automatic |

**Notes**

- Apex (`@`) to some PaaS (e.g. Vercel) may require **changing nameservers** to the provider or using **Cloudflare CNAME flattening** — Namecheap alone cannot always flatten apex CNAMEs.
- After changing DNS, wait for propagation (minutes–48h). Lower TTL before cutover if migrating.

**Registrar vs DNS**

- **Option A (recommended):** Namecheap → domain → **Nameservers: Custom** → point to **Cloudflare**. Manage all records in Cloudflare; SSL in §3.
- **Option B:** Keep Namecheap nameservers; use **A** records to a **VPS** you control and terminate TLS there (§3).

---

## 2–3. SSL / HTTPS and automatic renewal

### Option A — Cloudflare (recommended with Namecheap registrar)

1. Add site in Cloudflare; copy the two **nameservers** into Namecheap (**Domain → Nameservers → Custom**).
2. Create **A** or **CNAME** records for `hawanaairways.com`, `www`, `hams`, `api` (proxy **orange cloud** on for public sites).
3. **SSL/TLS** → set mode to **Full (strict)** once origin has a valid certificate (not “Flexible”).
4. **Always Use HTTPS**, **Automatic HTTPS Rewrites** — ON.
5. Renewal is **automatic** (Cloudflare-managed certs on edge). Origin on VPS should still use **Certbot** or **Caddy** auto HTTPS for origin cert.

### Option B — VPS + Let’s Encrypt (Certbot)

1. Nginx/Caddy fronts **:443** with certificates from Let’s Encrypt.
2. Install **certbot** with your web server plugin; enable **timer** for renewal (`systemctl list-timers | grep certbot`).
3. Force **HTTP → HTTPS** redirect server-side (matches Next middleware when `x-forwarded-proto` is set).

### Application layer

- Production **`NEXT_PUBLIC_API_URL`** must be **`https://api.hawanaairways.com`** (no mixed content).
- Backend **`FRONTEND_URL`** must list **exact** browser origins, comma-separated, e.g.  
  `https://hawanaairways.com,https://www.hawanaairways.com,https://hams.hawanaairways.com`  
  (omit `www` if you redirect it and never serve traffic on it.)

---

## 4. Protect production

| Control | Action |
|---------|--------|
| **Secrets** | Store in host secret manager (Vercel/Railway/Fly/AWS SSM). Never commit `.env` with real keys. |
| **Node** | `NODE_ENV=production`; strong `JWT_SECRET` (≥32 chars), `HAMS_ENCRYPTION_KEY` (≥32 chars). |
| **Admin API** | Optional `ADMIN_IP_ALLOWLIST` for `/api/system*`. |
| **DB** | Private network only; no public `0.0.0.0` bind for Postgres in prod. |
| **HTTP headers** | Already set in Next `next.config.mjs` (CSP, HSTS in prod). |
| **Access** | MFA / TOTP for admins where policy requires; rotate credentials on staff change. |

---

## 5. Staging vs production

| | Staging | Production |
|---|---------|------------|
| Public site | `https://staging.hawanaairways.com` | `https://hawanaairways.com` |
| HAMS app | `https://hams-staging.hawanaairways.com` | `https://hams.hawanaairways.com` |
| API | `https://api-staging.hawanaairways.com` | `https://api.hawanaairways.com` |
| Database | Separate `DATABASE_URL` | Dedicated Postgres, persistent disk / managed service |
| Git | Deploy from `develop` or `staging` branch | Deploy from `main` after PR + QA |

**Promotion:** same Git tag or commit SHA tested on staging → deploy to production → run **same** `apply-pending-migrations.sh` (skips completed versions). **Never** run destructive SQL against production.

---

## 6. Environment variables (by deployment)

### A) Public site build — `hawanaairways.com`

```env
NEXT_PUBLIC_API_URL=https://api.hawanaairways.com
NEXT_PUBLIC_SITE_URL=https://hawanaairways.com
NEXT_PUBLIC_CANONICAL_HOST=hawanaairways.com
NEXT_PUBLIC_BACKOFFICE_LOGIN_URL=https://hams.hawanaairways.com/login
```

### B) HAMS operations build — `hams.hawanaairways.com`

```env
NEXT_PUBLIC_API_URL=https://api.hawanaairways.com
NEXT_PUBLIC_SITE_URL=https://hams.hawanaairways.com
NEXT_PUBLIC_CANONICAL_HOST=hams.hawanaairways.com
# NEXT_PUBLIC_BACKOFFICE_LOGIN_URL not needed (same host as login)
```

### C) Backend — `api.hawanaairways.com`

```env
NODE_ENV=production
PORT=5013
DATABASE_URL=postgresql://…
JWT_SECRET=…
HAMS_ENCRYPTION_KEY=…
FRONTEND_URL=https://hawanaairways.com,https://www.hawanaairways.com,https://hams.hawanaairways.com
```

Add **staging** origins only on the **staging** API, never mix into production `FRONTEND_URL`.

See `frontend/.env.example` and `backend/.env.example` for the full list of optional keys (SMTP, backups, IP allowlist).

---

## 7. Automated backups

The backend includes a **backup scheduler** (`backupScheduler.js`) and encrypted exports (`backupService.js`). Minimum production settings:

```env
BACKUP_SCHEDULER_ENABLED=true
BACKUP_ENCRYPTION_KEY=<32+ random secret, separate from JWT>
BACKUP_ROOT_DIR=/var/lib/hams/backups
# Optional off-site (configure when ready):
# BACKUP_OFFSITE_PROVIDER=r2
# BACKUP_OFFSITE_BUCKET=…
# BACKUP_OFFSITE_ENDPOINT=…
```

Also use **managed Postgres backups** (PITR / daily snapshots) from your provider. Before **major** releases, take a manual **`pg_dump`** or provider snapshot. See `docs/CONTINUOUS_DEPLOYMENT.md`.

---

## 8–9. Continuous deploys and safe migrations

- **Code:** GitHub → PR → staging deploy → QA → production deploy (same artifact/commit).
- **Schema:** `bash backend/scripts/apply-pending-migrations.sh` after backups; additive, idempotent SQL only. See `database/migrations/README.md` and `docs/CONTINUOUS_DEPLOYMENT.md`.
- **Data:** Migrations must **not** reset production data; avoid `DROP`/`TRUNCATE` in shared paths.

---

## 10. Production logging and monitoring

| Layer | Suggestion |
|-------|------------|
| **HTTP / edge** | Cloudflare analytics / logs; or ALB access logs on AWS. |
| **App** | Platform logs (Vercel/Fly/Railway); ship JSON logs to **Datadog**, **Grafana Loki**, or **OpenSearch**. |
| **Errors** | **Sentry** (or similar) for Next + Node with environment tags `production` / `staging`. |
| **Uptime** | Synthetic checks: `GET https://api.hawanaairways.com/health` every 60s; `GET https://hams.hawanaairways.com/login`. |
| **DB** | Managed dashboard for connections, CPU, replication lag. |

Keep **PII out of logs**; log correlation IDs only where needed.

---

## Quick reference — deploy order (new environment)

1. Create **production Postgres**; run baseline SQL (`schema.sql` / `apply-db-fixes.sh` as per your bootstrap doc) once — **not** on every deploy.
2. Run **`apply-pending-migrations.sh`** for incremental updates.
3. Deploy **API** with env from §6C; verify `/health`.
4. Build & deploy **HAMS** Next app to `hams.hawanaairways.com` (§6B). On Vercel use **Root Directory** `frontend` and attach the custom domain to that project; **`docs/VERCEL_HAMS_DOMAIN.md`** fixes `404: DEPLOYMENT_NOT_FOUND`.
5. Build & deploy **public** Next app to `hawanaairways.com` (§6A) **or** a static site — ensure staff link points to `hams`.
6. Point DNS (§1); enable TLS (§2–3); smoke-test login and OCC from production URLs.

---

## Hawana Airways only

This runbook is for **Hawana Airways HAMS** (`hawanaairways.com` / `hams.hawanaairways.com`). Do not point these records at unrelated legacy projects; keep a single Git repo and pipeline for HAMS.
