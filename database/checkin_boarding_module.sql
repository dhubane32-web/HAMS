-- HAMS Check-in & Boarding module: boarding sequence + BOARDING status (idempotent).

ALTER TABLE checkins ADD COLUMN IF NOT EXISTS boarding_sequence INT;

CREATE INDEX IF NOT EXISTS idx_checkins_flight_boarding_seq ON checkins (flight_id, boarding_sequence);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkins_boarding_status_check') THEN
    ALTER TABLE checkins DROP CONSTRAINT checkins_boarding_status_check;
  END IF;
END $$;

ALTER TABLE checkins
  ADD CONSTRAINT checkins_boarding_status_check
  CHECK (boarding_status IN ('CHECKED_IN', 'BOARDING', 'BOARDED', 'NO_SHOW'));
