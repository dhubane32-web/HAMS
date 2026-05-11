# Hawana Airways HAMS — production deployment checklist

**Domains (production)**  
- `https://hawanaairways.com` — public site  
- `https://hams.hawanaairways.com` — HAMS operations  
- `https://api.hawanaairways.com` — API  

**Rules:** Do not reset production data. Keep staging separate. Use idempotent migrations only.

Architecture detail: **`docs/PRODUCTION_HAWANA_AIRWAYS.md`** · Continuous updates: **`docs/CONTINUOUS_DEPLOYMENT.md`**

---

## 1. OCC dashboard (before API cutover)

Run against the **target** database (staging first, then production after validation):

```bash
export DATABASE_URL='postgresql://…'
bash backend/scripts/apply-occ-migrations.sh
bash backend/scripts/apply-pending-migrations.sh
bash backend/scripts/verify-occ-schema.sh
```

**API smoke (after backend is up and you have a JWT):**

```bash
# obtain TOKEN via POST /api/auth/login, then:
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.hawanaairways.com/api/operations/occ/duty-limits"
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.hawanaairways.com/api/operations/occ/dashboard?date=$(date -u +%F)"
```

**Browser:** Flight & Operations → **OCC hub** → board loads; duty limits JSON present; **Refresh board** works.

---

## 2. Full backups & source control

| Step | Action |
|------|--------|
| Database | `export DATABASE_URL=…` && `bash scripts/backup-postgres.sh` — stores `backups/hams-pgdump-*.dump` (adjust `BACKUP_OUT_DIR`). |
| Restore drill | On a **scratch** database: `pg_restore --list` then partial restore test — prove backups are usable. |
| Source | `git status` clean; `git tag -a v2026.x.x -m "Production release"`; **`git push`** and **`git push --tags`** to GitHub. |
| Config | Export hosting env JSON or secret backup (no secrets in Git). |

---

## 3. Production environment (isolated from staging/localhost)

| Variable / area | Production |
|-------------------|--------------|
| `DATABASE_URL` | Production Postgres only (private network). |
| `JWT_SECRET`, `HAMS_ENCRYPTION_KEY` | Unique, ≥32 chars; not reused from staging. |
| `FRONTEND_URL` | `https://hawanaairways.com,https://www.hawanaairways.com,https://hams.hawanaairways.com` (exact list you serve). |
| Staging API | Must **not** include production origins on its `FRONTEND_URL`. |

Frontend builds: see **`frontend/.env.example`** (two blocks: public site vs `hams.` host).

---

## 4. Deploy backend API (`api.hawanaairways.com`)

1. Provision TLS (reverse proxy or PaaS HTTPS).  
2. Set all **`backend/.env.example`** production variables; enable **`BACKUP_SCHEDULER_ENABLED`** and **`BACKUP_ENCRYPTION_KEY`**.  
3. Deploy Node process; confirm `GET https://api.hawanaairways.com/health` → `{"ok":true,...}`.  
4. Logging: ship stdout to your log stack; optional Sentry on Node (see §10 in `PRODUCTION_HAWANA_AIRWAYS.md`).  
5. CORS: open browser devtools on `hams.` — no CORS errors on `/api/*`.

---

## 5. Deploy HAMS frontend (`hams.hawanaairways.com`)

1. Build with **`NEXT_PUBLIC_API_URL=https://api.hawanaairways.com`** and **`NEXT_PUBLIC_SITE_URL=https://hams.hawanaairways.com`**.  
2. Smoke: login, logout, dashboard, sidebar modules (Booking, Finance, Reports, OCC).  
3. Responsive: narrow viewport check on key pages.  
4. Public site build (`hawanaairways.com`) with **`NEXT_PUBLIC_BACKOFFICE_LOGIN_URL=https://hams.hawanaairways.com/login`**.

---

## 6. Namecheap DNS & SSL

1. Add **only** `hams` and `api` at your **authoritative DNS** (cPanel Zone Editor if NS point there). Do **not** change existing `@` / `www` / **MX** / mail **TXT** unless migrating the whole zone. Details: **`docs/DNS_HAMS_AND_API.md`**.  
2. Prefer **Cloudflare** (or equivalent) for **Full (strict)** TLS and automatic certificate renewal on the edge.  
3. Wait for propagation; run **`bash scripts/verify-hawana-production-dns.sh`** (or `dig` / online checker).  
4. Confirm padlock in browser for `hams` and `api` hosts.

---

## 7. Production testing matrix

Execute as **Super Admin** (or role-appropriate) test accounts:

| Area | Checks |
|------|--------|
| Login / session | Login, refresh, idle return, logout; cookie flags in prod (`Secure`, `SameSite`). |
| Dashboard | KPIs load; no blank charts blocking UI. |
| Booking & Ticketing | Create/search PNR path per your SOP. |
| Reports & Analytics | Open reports; export if applicable. |
| Finance & Accounting | Read balances / payments; restricted roles see gates. |
| RBAC | Agent vs finance vs ops — each sees allowed nav only. |
| Print / PDF | Ticket or document print path; PDF headers correct. |
| Errors | Induce 404 API — user sees safe message, no stack traces to client. |
| OCC | Board + duty limits + refresh (§1). |

Record sign-off names and date.

---

## 8. Automated backups & retention

| Item | Configuration |
|------|----------------|
| Daily / weekly / monthly | `BACKUP_SCHEDULER_*` env vars (backend). |
| Encryption | `BACKUP_ENCRYPTION_KEY` (dedicated secret). |
| Retention | `cleanupBackupsByRetention` rules in `backupService.js` — tune via env if exposed. |
| Off-site | When ready: `BACKUP_OFFSITE_PROVIDER` (e.g. R2) per `backend/.env.example`. |
| Recovery | Document RTO/RPO; keep **restore runbook** (who runs `pg_restore`, from which dump). |

---

## 9. Security (production hardening)

- Strong passwords + optional TOTP for admins.  
- **`ADMIN_IP_ALLOWLIST`** for `/api/system*` if ops IPs are stable.  
- Database: no public listen; firewall allowlist API host only.  
- Audit: backend `writeAudit` paths for sensitive actions — verify logs in your store.  
- Rotate secrets on staff departures.

---

## 10. Post-deploy (update-friendly)

- Tag Git release; keep **`apply-pending-migrations.sh`** as the only routine schema path for incremental updates.  
- Next deploy: staging first → same migrations → production → smoke tests — **never** drop production tables as part of deploy.

---

*This checklist is executed by your team on your infrastructure; it complements but does not replace your airline change-management policy (CAB, maintenance windows, etc.).*
