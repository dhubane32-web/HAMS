# HAMS Production Operations Guide

Enterprise operations reference for **Hawana Airways HAMS** on **Railway** (API + Postgres) and **Vercel** (Next.js frontend).

> **Security, RBAC matrix, audit SQL, and DR details:** see [PRODUCTION_SECURITY.md](./PRODUCTION_SECURITY.md).

---

## 1. Security report (summary)

| Control | Implementation |
|--------|------------------|
| Env validation at boot | `backend/src/config/envValidation.js` — blocks weak/missing secrets in production |
| Secrets in logs | `backend/src/lib/safeLog.js` — redacts tokens, URLs, keys |
| HTTP headers | `helmet` via `securityHeaders.js` (CSP, HSTS in prod) |
| CORS | `FRONTEND_URL` + `HAMS_EXTRA_CORS_ORIGINS`; localhost blocked in prod |
| Rate limits | Login, API, password-reset (`apiRateLimits.js`) |
| Brute-force | Account lockout (`loginSecurity.js`) |
| JWT | Min 32-char secret; max 48h expiry; session httpOnly in prod |
| CSRF / origin | `trustedOriginMutations.js` on state-changing routes |
| XSS / injection | `sanitizeBody.js`; parameterized SQL via `pg` |
| Passwords | bcrypt rounds 12 in prod (`bcryptConfig.js`) |
| Debug logs | Suppressed in production error handler |
| Admin surface | `/api/system/*` + optional `ADMIN_IP_ALLOWLIST` |

**Pre-deploy audit:** `cd backend && npm run security:audit`  
**Railway preflight:** `NODE_ENV=production node backend/scripts/railway-preflight.mjs`  
**Vercel preflight:** `NODE_ENV=production VERCEL=1 node frontend/scripts/vercel-preflight.mjs`  
**Unified:** `node scripts/predeploy-check.mjs --target all`

### Required production secrets (Railway `hams-backend`)

- `NODE_ENV=production`
- `DATABASE_URL` (from Postgres plugin)
- `JWT_SECRET` (≥32 chars)
- `HAMS_ENCRYPTION_KEY` (≥32 chars)
- `BACKUP_ENCRYPTION_KEY` (≥32 chars, **different** from encryption key)
- `FRONTEND_URL` (comma-separated HTTPS origins, no localhost)

### Required production secrets (Vercel)

- `HAMS_BACKEND_INTERNAL_URL` — Railway HTTPS API URL
- `NEXT_PUBLIC_USE_API_PROXY=true`
- `NEXT_PUBLIC_API_URL=/api`

---

## 2. Backup strategy

| Asset | Method | Retention |
|-------|--------|-----------|
| PostgreSQL | `pg_dump` → AES-256-GCM encrypted `.sql.enc` | Daily 30d (configurable) |
| Uploads / ticket PDFs / reports | Tar archives → encrypted | Same scheduler |
| Env snapshot | Redacted JSON → encrypted | Per backup run |

- **Scheduler:** `backupScheduler.js` — daily 02:00 UTC (defaults), weekly, monthly tiers
- **Verification:** Post-run checksum + weekly verify job
- **Alerts:** `HAMS_ALERT_WEBHOOK_URL` on failure
- **Storage:** `BACKUP_ROOT_DIR` (Railway volume recommended)
- **Admin UI/API:** `GET /api/system/backup/health`, restore via super-admin

**Manual verify:** `curl -sf "$API_BASE/api/system/backup/health" -H "Authorization: Bearer $TOKEN"`

---

## 3. Commercial Core — Phase 2

| Step | Command |
|------|---------|
| Apply migration 006 | `bash backend/scripts/apply-pending-migrations.sh` |
| Verify API | `cd backend && npm run test:commercial` |
| UI | **Commercial Core** (`/commercial`) — multi-city, SSR/OSI, reissue/refund, CRM profiles, notification outbox |

**API base:** `/api/commercial` — inventory, multi-city booking, SSR/OSI, ticket reissue/refund, profiles, notifications.

**Env (optional):** `HAMS_PNR_PREFIX=HW`, `HAMS_WHATSAPP_WEBHOOK_URL=https://…` for WhatsApp; SMTP for email (same as e-ticket).

**OCC integration:** Recording a flight delay via Operations/OCC queues `DELAY_ALERT` emails (and WhatsApp when configured) to booked passengers.

---

## 4. Enterprise Flight Operations (OCC)

| Step | Command |
|------|---------|
| Apply migrations | `export DATABASE_URL=...` && `bash backend/scripts/apply-pending-migrations.sh` |
| Seed demo ops data | `bash backend/scripts/seed-flight-ops-enterprise.sh` |
| Verify API (local) | `BASE_URL=http://127.0.0.1:5013` && `npm run test:flight-ops` (in `backend/`) |
| Full deploy pipeline | `bash scripts/deploy-enterprise-flight-ops.sh` |
| Production smoke | `bash scripts/verify-production-enterprise-ops.sh` |

**UI:** Flight Operations → **Enterprise ops** tab (live feed polls `/api/operations/enterprise/feed` every 20s).

**Key endpoints:** `/api/operations/enterprise/feed`, `/schedules`, `/rotations/rebuild`, `/assignments`, `/dispatch-releases/:id/pdf`, `/flights/:id/reschedule`, `/flights/:id/cancel`.

**OCC dashboard** (`/api/operations/occ/dashboard`) includes `enterprise: { conflictCount, openAlerts, dispatchPending }`.

---

## 4. Monitoring dashboard

### Public probes (no auth)

| Endpoint | Purpose |
|----------|---------|
| `GET /health/live` or `/live` | Liveness — process up |
| `GET /health/ready` or `/ready` | Readiness — Postgres connected |
| `GET /health` | Full status (version, memory, backup summary) |

**Script:** `bash scripts/verify-production-hardening.sh`

### Authenticated ops (super-admin)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/system/monitoring/ops` | Health + request metrics |
| `GET /api/system/diagnostics` | Full diagnostics (integrity, events, backup) |

Configure external uptime (Better Stack, UptimeRobot, etc.) against `/health/ready` every 1–5 minutes.

---

## 4. Production architecture

```
Browser → Vercel (Next.js)
            ├─ Static / RSC
            └─ /api/* proxy → Railway (Express API)
                                    ├─ JWT auth + RBAC
                                    ├─ Postgres (Railway plugin)
                                    ├─ Encrypted backups (volume)
                                    └─ JSONL system logs (var/logs)
```

- **Path B:** Browser never calls Railway directly; cookies/JWT flow through Vercel rewrite.
- **CORS:** Railway allows only `FRONTEND_URL` origins.
- **Health:** Railway healthcheck → `/health/live`; DB retry on startup before backup scheduler.

---

## 5. Recovery instructions

### A. Bad deploy (rollback)

1. Railway → `hams-backend` → Deployments → **Rollback** previous healthy deploy.
2. Vercel → Deployments → **Promote** last production build.
3. Verify: `bash scripts/verify-production-hardening.sh`

### B. Database / files loss

1. List backups: `GET /api/system/backup/logs` (super-admin).
2. Simulate: `POST /api/system/backup/:id/simulate-restore`
3. Restore: `bash scripts/disaster-restore.sh` (set `BACKUP_LOG_ID`, `DRY_RUN=false` after simulation).

### C. Locked out admin

1. Railway shell or local with `DATABASE_URL`:  
   `node backend/scripts/reset-hawana-admin-password.mjs`
2. Rotate `JWT_SECRET` only if compromise suspected (invalidates all sessions).

### D. SSL / custom domain

- Vercel → Domains → `hams.hawanaairways.com` — ensure certificate **Valid**.
- `FRONTEND_URL` must include exact production origin(s).

---

## 6. Admin maintenance guide

### Daily

- Confirm last backup: diagnostics or backup health endpoint.
- Review failed logins / 5xx in diagnostics (`recentSystemEvents`).

### Weekly

- Run `npm run security:audit` before releases.
- Apply pending migrations: `bash backend/scripts/apply-pending-migrations.sh`
- Run `node backend/scripts/check-migrations-safe.mjs` in CI.

### Before each release

```bash
node scripts/predeploy-check.mjs --target all
bash scripts/verify-production-hardening.sh
bash scripts/verify-production-api.sh   # with admin credentials
```

### Railway checklist

- [ ] `BACKUP_ENCRYPTION_KEY` set (unique, ≥32 chars)
- [ ] `FRONTEND_URL` matches Vercel + custom domains
- [ ] Postgres plugin attached
- [ ] Volume mounted at `BACKUP_ROOT_DIR` if using persistent backups

### Vercel checklist

- [ ] `HAMS_BACKEND_INTERNAL_URL` = current Railway URL
- [ ] Proxy env vars unchanged across preview/production as intended

### Migration safety

- Never commit `DROP DATABASE` / `TRUNCATE` in migrations without review.
- `004_system_ops_indexes.sql` — safe indexes only; apply via pending-migrations script.

---

## 7. Auto-recovery & stability

| Feature | Location |
|---------|----------|
| Railway restart on failure | `railway.toml` `restartPolicyType=ON_FAILURE` |
| DB connection retry | `index.js` `waitForDatabase()` |
| Graceful shutdown | `gracefulShutdown.js` (SIGTERM, pool drain) |
| Request timeout | `requestTimeout.js` (default 60s) |
| Connection pool | `config/db.js` (max 20, statement timeout) |
| Unhandled errors | Logged; process exit on `uncaughtException` |

---

## 8. Performance notes

- Audit/backup indexes: migration `004_system_ops_indexes.sql`
- Pool tuning: `HAMS_DB_POOL_MAX`, `HAMS_DB_STATEMENT_TIMEOUT_MS`
- Slow request tracking: `HAMS_SLOW_REQUEST_MS` (default 3000)
- Frontend: production build strips debug; use `/api` proxy (no extra CORS round-trips)

---

## 9. Alerting

Set `HAMS_ALERT_WEBHOOK_URL` (Slack/Discord-compatible JSON webhook) for:

- Backup failure / verification failure
- 5xx spike (`HAMS_ALERT_5XX_THRESHOLD`, default 15 per 5 minutes)
- Unhandled promise rejections
- Optional deploy shutdown (`HAMS_ALERT_ON_SHUTDOWN=true`)

## 9b. Emergency maintenance mode

Set `HAMS_MAINTENANCE_MODE=true` on Railway during DR or migrations. API returns **503** with `HAMS_MAINTENANCE_MESSAGE`; `/health/live` and `/health/ready` remain available for probes.

---

## 10. Support contacts

Document your on-call rotation and Hawana IT escalation here. Keep Railway and Vercel project access limited to super-admin staff.
