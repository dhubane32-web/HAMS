# HAMS database migrations (production-safe)

## Principles

1. **Never destructive by default** — Do not `DROP TABLE`, `TRUNCATE`, or `DELETE` wide ranges in migrations meant for production. Prefer `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, and guarded `UPDATE`s with `WHERE` clauses.
2. **Idempotent** — Every file must be safe to run more than once on the same database (same pattern as `occ_control_center.sql` and peers).
3. **Ordered** — Use numeric prefixes: `001_…sql`, `002_…sql`, `004_…sql`. Gaps are allowed. Only files matching `[0-9][0-9][0-9]_*.sql` are picked up by `apply-pending-migrations.sh`.
4. **One concern per file** — Easier to review, roll forward, and reason about in incidents.
5. **Test on staging first** — Apply the same migration to a copy of production schema or a nightly restore before production.

## Applying pending migrations

From repo root (requires `DATABASE_URL`):

```bash
bash backend/scripts/apply-pending-migrations.sh
```

This records each successfully applied file in `hams_schema_migrations` so re-runs skip completed versions.

## Bootstrap table

`000_schema_migrations_bootstrap.sql` creates `hams_schema_migrations`. The apply script runs it once before scanning numbered files (and records `000_schema_migrations_bootstrap.sql` after success).

## Production reconcile (008)

`008_production_schema_reconcile.sql` is the **catch-up** migration for Railway drift. It re-applies (idempotently):

- `001` — `sm_seat_leg_allocation`
- `002` / `003` — `backup_logs`
- `007` — OCC flight ETA / movement columns
- `bookings.travel_agent_id` (+ rename from legacy `travelAgent_id`)
- Minimum sales RM tables used by load-factor APIs

Run manually after deploy if boot migrations were skipped:

```bash
export DATABASE_URL='postgresql://…'
bash backend/scripts/apply-pending-migrations.sh
node backend/scripts/audit-schema.mjs
```

## Older one-off SQL

Large module bootstraps (e.g. `database/occ_control_center.sql`) remain in `database/` and are documented in `DEPLOYMENT.md` / `docs/CONTINUOUS_DEPLOYMENT.md`. Prefer **new** incremental changes as numbered files under `migrations/` going forward.
