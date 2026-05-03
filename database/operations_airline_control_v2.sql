-- Airline operations control: extended flight lifecycle, delay fields, dispatch checklist.
-- Idempotent. Run after schema.sql / flight_operations.sql.
-- Application layer also enforces minimum turnaround (see backend operations.js MIN_TURNAROUND_MINUTES).

ALTER TABLE flight_delays ADD COLUMN IF NOT EXISTS revised_departure TIMESTAMPTZ;
ALTER TABLE flight_delays ADD COLUMN IF NOT EXISTS operational_notes TEXT;

ALTER TABLE dispatch_logs ADD COLUMN IF NOT EXISTS checklist_json JSONB;

-- Migrate legacy landed → arrived
UPDATE flights SET status = 'ARRIVED' WHERE UPPER(TRIM(status)) = 'LANDED';

-- Normalize any unknowns to SCHEDULED
UPDATE flights SET status = 'SCHEDULED'
WHERE UPPER(TRIM(status)) NOT IN (
  'SCHEDULED',
  'CHECKIN_OPEN',
  'BOARDING',
  'GATE_CLOSED',
  'DEPARTED',
  'IN_AIR',
  'ARRIVED',
  'DELAYED',
  'CANCELLED'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flights_status_check') THEN
    ALTER TABLE flights DROP CONSTRAINT flights_status_check;
  END IF;
END $$;

ALTER TABLE flights
  ADD CONSTRAINT flights_status_check CHECK (
    status IN (
      'SCHEDULED',
      'CHECKIN_OPEN',
      'BOARDING',
      'GATE_CLOSED',
      'DEPARTED',
      'IN_AIR',
      'ARRIVED',
      'DELAYED',
      'CANCELLED'
    )
  );
