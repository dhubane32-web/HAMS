-- Hawana OCC (Operations Control Center): extensions after flight_operations / operations_airline_control_v2.
-- Idempotent: safe to re-run.

-- Live tracking / ETA (OCC updates these on status transitions)
ALTER TABLE flights ADD COLUMN IF NOT EXISTS actual_off_block_at TIMESTAMPTZ;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS actual_airborne_at TIMESTAMPTZ;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS actual_landed_at TIMESTAMPTZ;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS eta_current_at TIMESTAMPTZ;

-- Delay codes & financial impact (IATA-style codes; cost is estimate for finance visibility)
ALTER TABLE flight_delays ADD COLUMN IF NOT EXISTS delay_code VARCHAR(16);
ALTER TABLE flight_delays ADD COLUMN IF NOT EXISTS cost_impact_usd NUMERIC(14, 2);

CREATE TABLE IF NOT EXISTS occ_delay_code_ref (
  code VARCHAR(16) PRIMARY KEY,
  label VARCHAR(200) NOT NULL,
  default_cost_usd NUMERIC(12, 2) NOT NULL DEFAULT 0
);

INSERT INTO occ_delay_code_ref (code, label, default_cost_usd) VALUES
  ('WX', 'Weather / ATFM', 0),
  ('MX', 'Aircraft maintenance', 500),
  ('OP', 'Airline operations / crew', 300),
  ('ATC', 'ATC / flow', 0),
  ('SC', 'Station / ground handling', 200),
  ('PS', 'Passenger / security', 100)
ON CONFLICT (code) DO NOTHING;

-- Append-only flight timeline (OCC + integrations)
CREATE TABLE IF NOT EXISTS occ_flight_event (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  source_system VARCHAR(32) NOT NULL DEFAULT 'occ',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT occ_flight_event_source CHECK (source_system IN ('occ', 'booking', 'checkin', 'crew', 'finance', 'maintenance', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_occ_flight_event_flight ON occ_flight_event (flight_id, created_at DESC);

-- Fuel plan (latest wins — OCC replaces row per flight)
CREATE TABLE IF NOT EXISTS occ_fuel_plan (
  flight_id UUID PRIMARY KEY REFERENCES flights(id) ON DELETE CASCADE,
  planned_trip_kg NUMERIC(12, 2),
  taxi_kg NUMERIC(12, 2),
  contingency_kg NUMERIC(12, 2),
  alternate_kg NUMERIC(12, 2),
  planned_uplift_kg NUMERIC(12, 2),
  station VARCHAR(10),
  notes TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS occ_fuel_uplift (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  uplift_kg NUMERIC(12, 2) NOT NULL CHECK (uplift_kg > 0),
  receipt_ref VARCHAR(80),
  recorded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_occ_fuel_uplift_flight ON occ_fuel_uplift (flight_id);

-- Loadsheet / weight & balance (versioned)
CREATE TABLE IF NOT EXISTS occ_loadsheet (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  operating_empty_kg NUMERIC(12, 2),
  payload_kg NUMERIC(12, 2),
  zero_fuel_weight_kg NUMERIC(12, 2),
  takeoff_weight_kg NUMERIC(12, 2),
  cg_percent_mac NUMERIC(6, 3),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  limits_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  signed_by UUID REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT occ_loadsheet_status CHECK (status IN ('DRAFT', 'SIGNED', 'VOID'))
);

CREATE INDEX IF NOT EXISTS idx_occ_loadsheet_flight ON occ_loadsheet (flight_id, version DESC);

-- Irregular operations cases
CREATE TABLE IF NOT EXISTS occ_irops_case (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID REFERENCES flights(id) ON DELETE SET NULL,
  category VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  title VARCHAR(200) NOT NULL,
  narrative TEXT,
  opened_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  resolution_notes TEXT,
  CONSTRAINT occ_irops_status CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CLOSED')),
  CONSTRAINT occ_irops_cat CHECK (category IN ('MISCONNECT', 'WX', 'MX', 'CREW', 'STATION', 'SECURITY', 'OTHER'))
);

CREATE INDEX IF NOT EXISTS idx_occ_irops_flight ON occ_irops_case (flight_id);

-- Slot coordination
CREATE TABLE IF NOT EXISTS occ_slot (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  airport VARCHAR(10) NOT NULL,
  slot_kind VARCHAR(8) NOT NULL,
  slot_time TIMESTAMPTZ NOT NULL,
  coordinator_ref VARCHAR(80),
  status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT occ_slot_kind CHECK (slot_kind IN ('DEP', 'ARR')),
  CONSTRAINT occ_slot_status CHECK (status IN ('REQUESTED', 'CONFIRMED', 'MISSED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_occ_slot_flight ON occ_slot (flight_id);

-- Station control (per airport per day)
CREATE TABLE IF NOT EXISTS occ_station_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  airport_code VARCHAR(10) NOT NULL,
  state_date DATE NOT NULL,
  ramp_status VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
  notes TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS occ_station_state_airport_day
  ON occ_station_state (upper(trim(airport_code)), state_date);
