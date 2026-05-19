-- Enterprise flight operations: schedules, rotations, dispatch releases, slots, turnaround, alerts.
-- Idempotent. Run after schema.sql, flight_operations.sql, operations_airline_control_v2.sql, occ_control_center.sql

-- ─── Flight schedules (templates + recurring) ─────────────────────────────
CREATE TABLE IF NOT EXISTS flight_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_code VARCHAR(32) NOT NULL,
  route_id UUID REFERENCES ops_routes(id) ON DELETE SET NULL,
  flight_number VARCHAR(20) NOT NULL,
  origin_airport VARCHAR(10) NOT NULL,
  dest_airport VARCHAR(10) NOT NULL,
  scheduled_dep_time TIME NOT NULL,
  scheduled_arr_time TIME NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  recurrence_type VARCHAR(20) NOT NULL DEFAULT 'NONE'
    CHECK (recurrence_type IN ('NONE', 'DAILY', 'WEEKLY', 'SEASONAL')),
  days_of_week SMALLINT[] DEFAULT '{}',
  effective_from DATE NOT NULL,
  effective_to DATE,
  direction VARCHAR(16) NOT NULL DEFAULT 'ONE_WAY'
    CHECK (direction IN ('ONE_WAY', 'RETURN_OUT', 'RETURN_IN')),
  return_schedule_id UUID REFERENCES flight_schedules(id) ON DELETE SET NULL,
  default_aircraft_id UUID REFERENCES aircraft(id) ON DELETE SET NULL,
  aircraft_type_hint VARCHAR(80),
  seat_capacity_required INT,
  schedule_status VARCHAR(20) NOT NULL DEFAULT 'PLANNED'
    CHECK (schedule_status IN ('PLANNED', 'ACTIVE', 'DELAYED', 'CANCELLED', 'COMPLETED')),
  operational_day_offset INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS flight_schedules_code_uidx ON flight_schedules (upper(schedule_code));
CREATE INDEX IF NOT EXISTS flight_schedules_route_idx ON flight_schedules (route_id);
CREATE INDEX IF NOT EXISTS flight_schedules_effective_idx ON flight_schedules (effective_from, effective_to);
CREATE INDEX IF NOT EXISTS flight_schedules_status_idx ON flight_schedules (schedule_status);

-- Link operational flights back to schedule template
ALTER TABLE flights ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES flight_schedules(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS flights_schedule_id_idx ON flights (schedule_id);

-- ─── Aircraft assignments (tail assignment audit) ─────────────────────────
CREATE TABLE IF NOT EXISTS aircraft_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  aircraft_id UUID NOT NULL REFERENCES aircraft(id) ON DELETE RESTRICT,
  assignment_status VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED'
    CHECK (assignment_status IN ('AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'GROUNDED', 'STANDBY', 'DELAYED')),
  is_reserve BOOLEAN NOT NULL DEFAULT FALSE,
  auto_assigned BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS aircraft_assignments_flight_idx ON aircraft_assignments (flight_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS aircraft_assignments_aircraft_idx ON aircraft_assignments (aircraft_id, assigned_at DESC);

-- ─── Aircraft rotations (persisted day plan) ───────────────────────────────
CREATE TABLE IF NOT EXISTS aircraft_rotations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operational_date DATE NOT NULL,
  aircraft_id UUID NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  sequence_no INT NOT NULL DEFAULT 1,
  flight_id UUID REFERENCES flights(id) ON DELETE SET NULL,
  origin_airport VARCHAR(10),
  dest_airport VARCHAR(10),
  planned_dep TIMESTAMPTZ,
  planned_arr TIMESTAMPTZ,
  planned_turnaround_min INT,
  planned_block_min INT,
  overnight_station VARCHAR(10),
  rotation_status VARCHAR(20) NOT NULL DEFAULT 'PLANNED'
    CHECK (rotation_status IN ('PLANNED', 'ACTIVE', 'CONFLICT', 'COMPLETE', 'CANCELLED')),
  conflict_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operational_date, aircraft_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS aircraft_rotations_date_aircraft_idx ON aircraft_rotations (operational_date, aircraft_id);

-- ─── Dispatch releases (formal release package) ───────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_releases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  release_number VARCHAR(32) NOT NULL,
  release_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (release_status IN ('DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'DEPARTED', 'CLOSED')),
  fuel_plan_json JSONB DEFAULT '{}'::jsonb,
  weather_notes TEXT,
  mel_cdl_notes TEXT,
  payload_summary_json JSONB DEFAULT '{}'::jsonb,
  operational_remarks TEXT,
  crew_validated BOOLEAN NOT NULL DEFAULT FALSE,
  checklist_json JSONB DEFAULT '{}'::jsonb,
  dispatcher_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  captain_ack_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  pdf_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_releases_flight_active_uidx
  ON dispatch_releases (flight_id)
  WHERE release_status IN ('DRAFT', 'PENDING_APPROVAL', 'RELEASED');

CREATE INDEX IF NOT EXISTS dispatch_releases_status_idx ON dispatch_releases (release_status, released_at DESC);

-- ─── Airport slots ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS airport_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  airport VARCHAR(10) NOT NULL,
  slot_kind VARCHAR(8) NOT NULL CHECK (slot_kind IN ('DEP', 'ARR')),
  slot_time TIMESTAMPTZ NOT NULL,
  coordinator_ref VARCHAR(64),
  atc_remarks TEXT,
  priority VARCHAR(16) DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'HIGH', 'CRITICAL')),
  curfew_ok BOOLEAN NOT NULL DEFAULT TRUE,
  slot_status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED'
    CHECK (slot_status IN ('REQUESTED', 'CONFIRMED', 'HOLD', 'CANCELLED')),
  history_json JSONB DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS airport_slots_flight_idx ON airport_slots (flight_id);
CREATE INDEX IF NOT EXISTS airport_slots_airport_time_idx ON airport_slots (airport, slot_time);

-- Migrate legacy occ_slot rows if occ_slot exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'occ_slot') THEN
    INSERT INTO airport_slots (flight_id, airport, slot_kind, slot_time, coordinator_ref, slot_status, created_at)
    SELECT s.flight_id, s.airport, s.slot_kind, s.slot_time, s.coordinator_ref,
           CASE WHEN upper(trim(COALESCE(s.status, ''))) IN ('CONFIRMED', 'REQUESTED', 'HOLD', 'CANCELLED')
             THEN upper(trim(s.status)) ELSE 'CONFIRMED' END,
           COALESCE(s.created_at, NOW())
    FROM occ_slot s
    WHERE NOT EXISTS (
      SELECT 1 FROM airport_slots a
      WHERE a.flight_id = s.flight_id AND a.slot_kind = s.slot_kind AND a.slot_time = s.slot_time
    );
  END IF;
END $$;

-- ─── Turnaround events ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turnaround_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  station_code VARCHAR(10) NOT NULL,
  event_type VARCHAR(24) NOT NULL
    CHECK (event_type IN (
      'ARRIVAL', 'CLEANING', 'CATERING', 'FUELING', 'BOARDING',
      'BAGGAGE', 'TECHNICAL', 'GATE', 'READY', 'DEPARTURE'
    )),
  event_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (event_status IN ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'DELAYED', 'SKIPPED')),
  planned_at TIMESTAMPTZ,
  actual_at TIMESTAMPTZ,
  planned_duration_min INT,
  delay_reason TEXT,
  assigned_team VARCHAR(80),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS turnaround_events_flight_idx ON turnaround_events (flight_id, sort_order);

-- ─── Operational alerts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operational_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_type VARCHAR(40) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  flight_id UUID REFERENCES flights(id) ON DELETE CASCADE,
  aircraft_id UUID REFERENCES aircraft(id) ON DELETE SET NULL,
  schedule_id UUID REFERENCES flight_schedules(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  alert_status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (alert_status IN ('OPEN', 'ACK', 'CLOSED')),
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS operational_alerts_open_idx ON operational_alerts (alert_status, severity, created_at DESC);
