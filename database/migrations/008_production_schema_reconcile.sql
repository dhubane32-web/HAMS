-- Production schema reconcile — idempotent catch-up for Railway drift.
-- Safe to run multiple times; never DROP/TRUNCATE production data.
-- Re-applies core migrations 001–003, 007, bookings commercial columns, and naming fixes.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\ir 001_sm_seat_leg_allocation.sql
\ir 002_backup_logs.sql
\ir 003_backup_logs_production_upgrade.sql
\ir 007_occ_flight_tracking_columns.sql

-- ---------------------------------------------------------------------------
-- bookings: standardize travel_agent_id (fix legacy camelCase column names)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'travelAgent_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'travel_agent_id'
  ) THEN
    ALTER TABLE bookings RENAME COLUMN "travelAgent_id" TO travel_agent_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'travelagent_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'travel_agent_id'
  ) THEN
    ALTER TABLE bookings RENAME COLUMN travelagent_id TO travel_agent_id;
  END IF;
END $$;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sales_channel_code VARCHAR(40) NOT NULL DEFAULT 'DIRECT_WEB';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS corporate_account_id UUID;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS travel_agent_id UUID;

CREATE INDEX IF NOT EXISTS idx_bookings_sales_channel ON bookings (sales_channel_code);
CREATE INDEX IF NOT EXISTS idx_bookings_corporate ON bookings (corporate_account_id);
CREATE INDEX IF NOT EXISTS idx_bookings_travel_agent ON bookings (travel_agent_id);

DO $$
BEGIN
  IF to_regclass('public.sales_travel_agents') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_travel_agent_id_fkey') THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_travel_agent_id_fkey
      FOREIGN KEY (travel_agent_id) REFERENCES sales_travel_agents (id);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'bookings_travel_agent_id_fkey skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF to_regclass('public.sales_corporate_customers') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_corporate_account_id_fkey') THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_corporate_account_id_fkey
      FOREIGN KEY (corporate_account_id) REFERENCES sales_corporate_customers (id);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'bookings_corporate_account_id_fkey skipped: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- Sales RM minimum (load factor / bucket recalc uses sm_seat_leg_allocation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sm_sales_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  default_commission_pct NUMERIC(6, 3) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sm_sales_channels (code, name, default_commission_pct)
VALUES
  ('DIRECT_WEB', 'Website direct', 0),
  ('MOBILE_APP', 'Mobile app', 0),
  ('AGENT_PORTAL', 'Travel agent portal', 7),
  ('CORPORATE_PORTAL', 'Corporate portal', 3),
  ('API', 'API partner', 5),
  ('OTA', 'Online travel agency', 12),
  ('GDS_PREP', 'GDS (preparation)', 10),
  ('CALL_CENTER', 'Call center', 0)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS sm_rm_flight_bucket (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights (id) ON DELETE CASCADE,
  fare_class_id UUID NOT NULL REFERENCES md_fare_classes (id) ON DELETE CASCADE,
  seats_allocated INT NOT NULL DEFAULT 0 CHECK (seats_allocated >= 0),
  seats_sold INT NOT NULL DEFAULT 0 CHECK (seats_sold >= 0),
  bucket_open BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flight_id, fare_class_id)
);

CREATE INDEX IF NOT EXISTS idx_sm_rm_flight_bucket_flight ON sm_rm_flight_bucket (flight_id);

CREATE TABLE IF NOT EXISTS sm_rm_policy (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  load_factor_close_bucket NUMERIC(5, 2) NOT NULL DEFAULT 0.78,
  load_factor_open_upper NUMERIC(5, 2) NOT NULL DEFAULT 0.55,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sm_rm_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DO $mig$
BEGIN
  IF to_regclass('public.sales_travel_agents') IS NULL THEN
    RAISE NOTICE 'sales_travel_agents missing; sm_agent_commissions creation skipped';
    RETURN;
  END IF;
  CREATE TABLE IF NOT EXISTS sm_agent_commissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    ticket_id UUID REFERENCES tickets (id) ON DELETE SET NULL,
    travel_agent_id UUID REFERENCES sales_travel_agents (id),
    channel_code VARCHAR(40) REFERENCES sm_sales_channels (code),
    base_amount NUMERIC(14, 2) NOT NULL,
    commission_rate NUMERIC(8, 4) NOT NULL,
    commission_amount NUMERIC(14, 2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(20) NOT NULL DEFAULT 'ACCRUED',
    rule_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
END $mig$;

DO $mig$
BEGIN
  IF to_regclass('public.sm_agent_commissions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_sm_agent_commissions_booking ON sm_agent_commissions (booking_id);
    CREATE INDEX IF NOT EXISTS idx_sm_agent_commissions_agent ON sm_agent_commissions (travel_agent_id);
  END IF;
END $mig$;

-- ---------------------------------------------------------------------------
-- flight_delays + OCC delay reference (dashboard / enterprise delays)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flight_delays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights (id) ON DELETE CASCADE,
  delay_minutes INT NOT NULL,
  reason TEXT,
  reported_by UUID REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE flight_delays ADD COLUMN IF NOT EXISTS delay_code VARCHAR(16);
ALTER TABLE flight_delays ADD COLUMN IF NOT EXISTS cost_impact_usd NUMERIC(14, 2);
ALTER TABLE flight_delays ADD COLUMN IF NOT EXISTS revised_departure TIMESTAMPTZ;
ALTER TABLE flight_delays ADD COLUMN IF NOT EXISTS operational_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_flight_delays_flight ON flight_delays (flight_id);

CREATE TABLE IF NOT EXISTS occ_delay_code_ref (
  code VARCHAR(16) PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  default_cost_usd NUMERIC(14, 2) NOT NULL DEFAULT 0
);

INSERT INTO occ_delay_code_ref (code, label, default_cost_usd) VALUES
  ('WX', 'Weather', 0),
  ('ATC', 'ATC / flow control', 0),
  ('TECH', 'Technical / maintenance', 500),
  ('CREW', 'Crew', 200),
  ('OPS', 'Operational', 100),
  ('SEC', 'Security', 0),
  ('OTHER', 'Other', 0)
ON CONFLICT (code) DO NOTHING;
