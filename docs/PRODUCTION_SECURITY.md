# HAMS Production Security & Reliability

Companion to [PRODUCTION_OPERATIONS.md](./PRODUCTION_OPERATIONS.md) — security controls, RBAC, audit queries, DR, and deployment policy for **Railway** (API + Postgres) and **Vercel** (Next.js).

---

## 1. Railway environment variables (admin checklist)

| Variable | Required (prod) | Purpose |
|----------|-----------------|--------|
| `NODE_ENV` | Yes | `production` |
| `DATABASE_URL` | Yes | Postgres (Railway plugin) |
| `JWT_SECRET` | Yes | ≥32 chars; session signing |
| `HAMS_ENCRYPTION_KEY` | Yes | ≥32 chars; TOTP / sensitive fields |
| `BACKUP_ENCRYPTION_KEY` | Yes | ≥32 chars; **different** from encryption key |
| `FRONTEND_URL` | Yes | Comma-separated HTTPS origins (no localhost) |
| `HAMS_ALERT_WEBHOOK_URL` | Recommended | Slack/Discord JSON webhook for ops alerts |
| `BACKUP_ROOT_DIR` | Recommended | Persistent volume path for encrypted backups |
| `BACKUP_SCHEDULER_ENABLED` | Optional | Default `true` |
| `BACKUP_RETENTION_DAILY_DAYS` | Optional | Default `30` |
| `BACKUP_VERIFY_AFTER_RUN` | Optional | Post-backup simulate restore (default `true`) |
| `HAMS_HTTPONLY_SESSION` | Optional | Default `true` in production |
| `HAMS_MAINTENANCE_MODE` | DR only | `true` → 503 except `/health/*` |
| `HAMS_MAINTENANCE_MESSAGE` | Optional | Custom 503 body text |
| `ADMIN_IP_ALLOWLIST` | Optional | Restrict `/api/system/*` by IP/CIDR |
| `HAMS_DB_POOL_MAX` | Optional | Connection pool size (default 20) |
| `HAMS_DB_SLOW_QUERY_MS` | Optional | Log queries slower than N ms |
| `HAMS_ALERT_5XX_THRESHOLD` | Optional | Spike alert count (default 15 / 5 min) |

### Vercel (frontend)

| Variable | Required (prod) | Purpose |
|----------|-----------------|--------|
| `HAMS_BACKEND_INTERNAL_URL` | Yes | Railway HTTPS API URL |
| `NEXT_PUBLIC_USE_API_PROXY` | Yes | `true` — browser uses `/api` proxy |
| `NEXT_PUBLIC_API_URL` | Yes | `/api` |

---

## 2. Backup strategy

- **Daily** full backup at 02:00 UTC (configurable): Postgres `pg_dump`, uploads, ticket PDFs, reports, env snapshot.
- **Encryption:** AES-256-GCM envelope (`BACKUP_ENCRYPTION_KEY` required in prod).
- **Retention:** Daily 30 days (default), weekly 90 days, monthly 365 days.
- **Verification:** Post-run simulate restore when `BACKUP_VERIFY_AFTER_RUN=true`; weekly job Sundays 03:30 UTC.
- **Alerts:** Backup failure → `HAMS_ALERT_WEBHOOK_URL`.
- **Pre-deploy:** Run manual backup or confirm last daily success before Railway deploy (see `railway.toml` comment).

```bash
# Super-admin health check
curl -sf "$API/api/system/backup/health" -H "Authorization: Bearer $TOKEN"
```

---

## 3. Monitoring endpoints

| Endpoint | Auth | Use |
|----------|------|-----|
| `GET /health/live` | No | Liveness (Railway healthcheck) |
| `GET /health/ready` | No | Readiness (Postgres) |
| `GET /health` | No | Full status |
| `GET /api/system/monitoring/ops` | Super-admin | Request metrics + failed logins |
| `GET /api/system/diagnostics` | Super-admin | Health, backup, DB integrity, pool stats |

External uptime tools should probe `/health/ready` every 1–5 minutes.

---

## 4. Alerting (`HAMS_ALERT_WEBHOOK_URL`)

JSON POST payload: `{ severity, title, message, service, timestamp, context }`.

| Event | Severity |
|-------|----------|
| Backup failure | critical |
| Backup verification failure | warning |
| 5xx spike (threshold in window) | warning |
| Unhandled rejection | critical |
| Optional deploy shutdown | info |

Tune: `HAMS_ALERT_5XX_THRESHOLD` (default 15), `HAMS_ALERT_5XX_WINDOW_SEC` (300), `HAMS_ALERT_COOLDOWN_SEC` (600).

---

## 5. RBAC matrix (roles ↔ modules)

`super_admin` inherits all `admin` API permissions. Frontend nav: `frontend/lib/nav-config.ts`; API guards: `backend/src/lib/airlineRbac.js`.

| Role | Dashboard | Booking | Check-in | Ops | Maintenance | Crew | Finance | Sales | CS | Reports | Settings | Admin |
|------|:---------:|:-------:|:--------:|:---:|:-----------:|:----:|:-------:|:-----:|:--:|:-------:|:--------:|:-----:|
| super_admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| operations | ✓ | — | ✓ | ✓ | ✓* | ✓ | — | — | — | ✓ | — | — |
| finance | ✓ | — | — | — | — | — | ✓ | — | — | ✓ | — | — |
| booking_agent / agent | ✓ | ✓ | — | — | — | — | — | — | — | ✓ | — | — |
| checkin_agent | ✓ | — | ✓ | — | — | — | — | — | — | — | — | — |
| maintenance | ✓ | — | — | — | ✓ | — | — | — | — | ✓ | — | — |
| crew | ✓ | — | — | — | — | ✓ | — | — | — | — | — | — |
| sales_manager | ✓ | ✓ | — | — | — | — | — | ✓ | — | ✓ | — | — |
| customer_service | ✓ | ✓ | — | — | — | — | — | — | ✓ | — | — | — |

\*Maintenance role sees flight list context via ops API; maintenance UI is `/maintenance`.

---

## 6. Audit logs (super-admin queries)

Login attempts are stored in `login_history` and `audit_logs` (`LOGIN_SUCCESS`, `LOGIN_FAILED`, etc.). Operational events also append to `var/logs/system-events.jsonl`.

```sql
-- Recent failed logins (24h)
SELECT email, ip_address, reason, created_at
FROM login_history
WHERE success = FALSE AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 50;

-- Finance / booking / admin mutations
SELECT u.email, a.action, a.entity, a.entity_id, a.metadata, a.ip_address, a.created_at
FROM audit_logs a
LEFT JOIN users u ON u.id = a.user_id
WHERE a.created_at >= NOW() - INTERVAL '7 days'
  AND a.action NOT LIKE 'SYSTEM_%'
ORDER BY a.created_at DESC
LIMIT 100;

-- System / deployment events
SELECT action, metadata, created_at
FROM audit_logs
WHERE action LIKE 'SYSTEM_%'
ORDER BY created_at DESC
LIMIT 50;
```

API: `GET /api/system/audit-logs` (super-admin, paginated).

---

## 7. Disaster recovery

### Enable maintenance mode (before restore)

```bash
# Railway → hams-backend → Variables
HAMS_MAINTENANCE_MODE=true
HAMS_MAINTENANCE_MESSAGE="HAMS restore in progress — back shortly."
```

Health probes (`/health/live`, `/health/ready`) still return 200; users receive 503 on API/UI proxy.

### Restore from backup

1. List backups: `GET /api/system/backup/logs`
2. Simulate: `POST /api/system/backup/:id/simulate-restore`
3. Execute: `bash scripts/disaster-restore.sh` with `BACKUP_LOG_ID` and `DRY_RUN=false`
4. Verify: `bash scripts/verify-production-hardening.sh`
5. Disable maintenance mode

### Bad deploy rollback

1. Railway → Deployments → **Rollback** previous healthy API deploy.
2. Vercel → **Promote** last production frontend build.
3. Confirm `HAMS_BACKEND_INTERNAL_URL` matches current Railway URL.
4. Run `node scripts/predeploy-check.mjs --target all`

---

## 8. Deployment policy

```bash
# Before every production release
node scripts/predeploy-check.mjs --target all
bash scripts/verify-production-hardening.sh
bash scripts/verify-production-auth-flow.sh   # optional: ADMIN_EMAIL ADMIN_PASSWORD
cd backend && npm run security:audit
```

### Production auth verification

- **Cookie:** `hams_token` only (middleware + `ProtectedAuthGate`; localStorage synced client-side).
- **Redirects:** `/` → `/login` or `/dashboard`; unauthenticated `/dashboard` → `/login?next=…`.
- **Debug (non-prod default):** set `NEXT_PUBLIC_HAMS_AUTH_DEBUG=true` on a preview deploy only — logs `[hams-auth]` to the browser console, no secrets.
- **Manual login:** required when `ADMIN_EMAIL` / `ADMIN_PASSWORD` are not set for `verify-production-auth-flow.sh`.

- **Railway:** Dockerfile deploy; healthcheck `/health/live`; restart on failure.
- **Vercel:** `buildCommand` runs `generate-build-meta.mjs` + `vercel-preflight.mjs` then `next build` (cache bust via build meta).
- **Migrations:** `bash backend/scripts/apply-pending-migrations.sh` — never auto-destructive SQL in prod.
- **Optional:** Trigger manual backup via super-admin API before major schema migrations.

---

## 9. Security controls (reference)

| Control | Location |
|---------|----------|
| Boot env validation | `config/envValidation.js` |
| Helmet / CSP / HSTS | `middleware/securityHeaders.js` |
| CSRF origin | `middleware/trustedOriginMutations.js` |
| XSS sanitize | `middleware/sanitizeBody.js` |
| Rate limits | `middleware/apiRateLimits.js` |
| httpOnly session | `lib/sessionCookie.js` |
| bcrypt rounds | `lib/bcryptConfig.js` |
| Safe logging | `lib/safeLog.js` |
| Graceful shutdown | `lib/gracefulShutdown.js` |
