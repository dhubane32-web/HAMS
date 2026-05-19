# HAMS enterprise airline transformation (incremental)

This rollout adds **standalone enterprise modules** without removing existing workflows.

## New frontend modules

| Module | Route | Backend |
|--------|-------|---------|
| Operations Control Center | `/occ` | `/api/operations/occ/*` |
| Live Flight Tracking | `/live-flights` | Dashboard + OCC |
| Flight Dispatch | `/dispatch` | `/api/operations/enterprise/dispatch-releases/*` |
| Crew Control | `/crew-control` | `/api/crew` + OCC legality |
| Revenue Management | `/revenue` | `/api/sales/commercial/*` |
| Safety & Compliance | `/safety` | `/api/safety/*` |

## Renamed (labels only)

- **Sales & Marketing** → **Commercial & Revenue** (`/sales`)
- **Customer Service** → **Passenger Services** (`/customers` → `/customer-service`)

## Preserved

- `/operations` — schedule, control, OCC tab, enterprise tab
- All booking, check-in, finance, and admin flows
- PostgreSQL schema (migrations only additive)

## Database

- `009_safety_compliance_sms.sql` — SMS incidents, risk register, corrective actions

## Deploy

1. Push to `main`
2. Railway redeploy (repo root Dockerfile)
3. `bash scripts/sync-railway-production.sh` (applies 008 + 009)
4. Vercel redeploy frontend

## Future (Phase 13 prep)

- WebSocket feed: set `HAMS_WS_ENABLED=true` when realtime hub is enabled
- GDS / ADS-B / BSP: integration points documented in `lib/enterprise-modules.ts`
