# HAMS production schema audit

## Symptoms (Railway logs)

| Error | Fix (migration 008) |
|-------|---------------------|
| `relation "sm_seat_leg_allocation" does not exist` | `\ir 001_sm_seat_leg_allocation.sql` |
| `relation "backup_logs" does not exist` | `\ir 002` + `003` |
| `column b.travelAgent_id does not exist` | Rename legacy column → `travel_agent_id` |
| `column f.eta_current_at does not exist` | `\ir 007` + boot `ensureOccEtaColumns()` |

Backend code uses **snake_case** (`travel_agent_id`, `eta_current_at`). JSON/API may use camelCase (`travelAgentId`) — that is not a database column name.

## Audit commands

```bash
export DATABASE_URL='postgresql://…'   # Railway Postgres → Connect

# Apply all pending migrations (including 008)
bash scripts/sync-railway-production.sh

# Read-only report
node backend/scripts/audit-schema.mjs

# HTTP (after redeploy)
curl -s https://YOUR-RAILWAY.up.railway.app/health/schema | jq
```

## Expected tables (required)

`sm_seat_leg_allocation`, `backup_logs`, `flight_schedules`, `dispatch_releases`, `aircraft_rotations`, `occ_flight_event`, `flight_delays`, …

See `backend/src/services/schemaRegistry.js`.

## Strict readiness

Set `HAMS_SCHEMA_STRICT=true` on Railway to return **503** on `/health/ready` when schema drift is detected (default: report drift but stay ready for gradual rollout).
