-- Check-in & boarding: idempotent schema extensions + unique seat per flight.
-- Legacy databases may have `checkins` without boarding/reporting columns — add safely.

ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS boarding_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS checkin_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS boarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS boarding_gate VARCHAR(20);

UPDATE checkins
SET boarding_status = 'CHECKED_IN'
WHERE boarding_status IS NULL OR btrim(boarding_status::text) = '';

UPDATE checkins
SET checkin_status = 'COMPLETED'
WHERE checkin_status IS NULL OR btrim(checkin_status::text) = '';

ALTER TABLE checkins ALTER COLUMN boarding_status SET DEFAULT 'CHECKED_IN';
ALTER TABLE checkins ALTER COLUMN checkin_status SET DEFAULT 'COMPLETED';

ALTER TABLE checkins ALTER COLUMN boarding_status SET NOT NULL;
ALTER TABLE checkins ALTER COLUMN checkin_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkins_boarding_status_check'
  ) THEN
    ALTER TABLE checkins
      ADD CONSTRAINT checkins_boarding_status_check
      CHECK (boarding_status IN ('CHECKED_IN', 'BOARDED', 'NO_SHOW'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkins_checkin_status_check'
  ) THEN
    ALTER TABLE checkins
      ADD CONSTRAINT checkins_checkin_status_check
      CHECK (checkin_status IN ('PENDING', 'COMPLETED', 'CANCELLED'));
  END IF;
END $$;

-- Historical rows marked boarded before boarded_at existed
UPDATE checkins
SET boarded_at = checkin_time
WHERE upper(btrim(boarding_status::text)) = 'BOARDED'
  AND boarded_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_flight_seat_uidx
ON checkins (flight_id, (upper(btrim(seat_number::text))))
WHERE seat_number IS NOT NULL AND btrim(seat_number::text) <> '';
