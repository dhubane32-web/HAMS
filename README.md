# HAMS - Hawana Airways Management System

HAMS is a full Airline Management System for Hawana Airways.

## Tech Stack
- Frontend: Next.js (React + TypeScript)
- Backend: Node.js + Express
- Database: PostgreSQL

## Modules
1. Login & User Roles (Admin, Finance, Operations, Agent, Crew, Maintenance)
2. Flight Booking (search, booking, PNR, ticket issuance)
3. Check-in (PNR retrieval, seats, baggage, boarding pass)
4. Finance (payments, refunds, daily reports)
5. Operations (schedule, aircraft/crew assignment, dispatch)
6. Maintenance (defect log, release status)
7. Role dashboards

## Initial Delivery
- Full project structure
- PostgreSQL schema covering all requested entities
- Working login page with HAMS branding (blue + white)
- Backend authentication endpoint and role-aware token payload

## Quick Start
1. Create PostgreSQL database and run:
   - `database/schema.sql`
   - `database/seed.sql`
2. Install packages: `npm install`
3. Configure backend env in `backend/.env` (see `backend/.env.example`)
4. Start backend: `npm run dev:backend`
5. Start frontend: `npm run dev:frontend`

Login seed users are provided in `database/seed.sql`.

## Deploying the HAMS frontend (Vercel)

Production host: **`https://hams.hawanaairways.com`**. The Next.js app lives under **`frontend/`** — in Vercel set **Root Directory** to `frontend` and add the domain on **that** Git-linked project.

- **`404: DEPLOYMENT_NOT_FOUND`** after DNS works → **`docs/VERCEL_HAMS_DOMAIN.md`**
- DNS / API hostnames only → **`docs/DNS_HAMS_AND_API.md`**

## Branding source lock

- Official source of truth: `frontend/public/brand/source/Hawana Logo Monotone.pdf`
- Generate brand assets from source: `cd frontend && npm run brand:build`
- Generated outputs: `frontend/public/brand/hawana-logo.png`, `hawana-logo-dark.png`, `favicon.ico` (and optional `hawana-logo.svg` via `pdf2svg`)
- Duplicate or legacy source PDF files are blocked by the brand build script
