# HAMS — continuous deployment and safe updates

For **Hawana Airways live domains** (`hawanaairways.com`, `hams.hawanaairways.com`, API, Namecheap/SSL), read **`docs/PRODUCTION_HAWANA_AIRWAYS.md`** first.

HAMS is designed to **keep evolving** after go-live: new modules, reports, forms, and UI fixes ship from Git while **production data stays protected**.

## 1. Source of truth: Git + editable environments

| Where you work | Role |
|----------------|------|
| **GitHub (or GitLab, etc.)** | Canonical history, code review, tags/releases. |
| **Cursor / local** | Day-to-day development and refactors. |
| **Replit** | Optional cloud IDE; point it at the same Git remote so it is not a second “truth.” |

**Practice**

- Use **feature branches** → **pull requests** → merge to `main` (or `develop` → `main`).
- Tag releases (`v2026.05.11`) when you cut a production deploy so you can diff or roll back **code** easily.
- Never commit real `.env` secrets; use host-specific env vars and secret managers.

## 2. Separate staging from production

| | **Staging** | **Production** |
|---|-------------|----------------|
| **App URL** | e.g. `https://staging.hawana.example` | Live customer/staff domain |
| **`DATABASE_URL`** | Staging Postgres (copy or anonymized dump) | Production Postgres only |
| **`FRONTEND_URL` / CORS** | Include staging origin | Production origins only |
| **`JWT_SECRET` / keys** | Different values from prod | Strong, rotated independently |

**Workflow**

1. Merge to a **staging** branch (or deploy `main` to staging first).
2. Run **migrations** on staging DB (see below).
3. **QA** all critical paths (login, OCC, booking, finance smoke tests).
4. Deploy **the same commit** to production and run the **same migration set** there (script skips already-applied files).

## 3. Database changes without data loss

### Rules

- Prefer **additive** changes: new tables/columns/indexes, new rows via `INSERT … ON CONFLICT DO NOTHING`.
- Avoid **`DROP TABLE` / `TRUNCATE`** in shared migration paths.
- Scripts under `database/` used for first-time bootstrap (e.g. `schema.sql`, `occ_control_center.sql`) are **idempotent** where possible; for ongoing work prefer **`database/migrations/NNN_description.sql`**.

### Tracked migrations

```bash
export DATABASE_URL='postgresql://…'
bash backend/scripts/apply-pending-migrations.sh
```

- Creates/uses **`hams_schema_migrations`** (see `000_schema_migrations_bootstrap.sql`).
- Applies only **`[0-9][0-9][0-9]_*.sql`** files not yet recorded.
- See **`database/migrations/README.md`** for authoring rules.

### Full baseline / repair (rare on production)

```bash
bash backend/scripts/apply-db-fixes.sh
```

Use only when you intend to align a database with the full scripted baseline (still largely idempotent). **Take a backup first** (below).

## 4. Backups before major updates

- **Built-in:** The backend can run scheduled encrypted backups (see `backupScheduler.js` and env vars like `BACKUP_SCHEDULER_ENABLED`). Configure storage paths and retention for your host.
- **Manual (always before risky DB work):** Take a `pg_dump` / provider snapshot and verify restore on a scratch instance.
- **Application-level:** Exports from finance/settings where the product supports them.

**Checklist before production DB migration**

1. Staging migration succeeded.
2. Fresh **backup** + restore drill (optional but recommended quarterly).
3. Maintenance window communicated if downtime is possible.
4. Run `apply-pending-migrations.sh` on production.
5. Deploy new **backend** / **frontend** builds that depend on the schema.

## 5. Deploying the app (domain + updates)

- **Frontend:** Build from `frontend/` (`npm run build` / host on Vercel, etc.). Set `NEXT_PUBLIC_*` per environment; rebuild when those change.
- **Backend:** `NODE_ENV=production`, process manager or container, HTTPS reverse proxy. Set `FRONTEND_URL` to every allowed browser origin.
- **Domain:** DNS to your edge; TLS termination; optional `NEXT_PUBLIC_CANONICAL_HOST` for apex/www behavior (see root `DEPLOYMENT.md`).

**Continuous updates**

- New **UI**: merge → build → deploy static/server bundle.
- New **API**: merge → deploy Node process → run migrations **before** or **in lockstep** with code that requires new columns.
- **Feature flags** (optional): gate risky modules via env or DB settings so production can ship code dark.

## 6. Testing before production

- **Automated:** Add/extend API scripts under `backend/scripts/verify-*.mjs` and run in CI against a disposable DB.
- **Manual:** Staging checklist (login, RBAC, OCC hub, booking happy path, finance read).
- **Preview deploys:** Many hosts support “preview URL per PR”; point `DATABASE_URL` at staging or a branch-specific DB.

## 7. Replit-specific notes

- Connect Replit to **GitHub** and treat Replit as a remote dev machine: **pull before work**, **push** to the same branches others use.
- Use Replit **Secrets** for `DATABASE_URL` (staging), never production secrets in a public Repl.
- Run migrations from the Replit shell against **staging** by default.

## 8. What “done” never means

Deployment is a **checkpoint**, not the end of change management. Keep:

- A living **staging** environment,
- **Versioned migrations** and backup discipline,
- **Small, reviewable PRs**,

so new modules and fixes can ship for years without resetting customer data.
