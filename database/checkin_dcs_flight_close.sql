-- DCS: close passenger check-in for a flight (blocks new check-ins; manifest/boarding ops may continue per policy).
ALTER TABLE flights
  ADD COLUMN IF NOT EXISTS checkin_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkin_closed_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_flights_checkin_closed_at ON flights (checkin_closed_at)
  WHERE checkin_closed_at IS NOT NULL;
