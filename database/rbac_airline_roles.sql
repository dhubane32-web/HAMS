-- Airline RBAC: narrow desk roles (idempotent enum extension).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'booking_agent'
  ) THEN
    ALTER TYPE user_role ADD VALUE 'booking_agent';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'checkin_agent'
  ) THEN
    ALTER TYPE user_role ADD VALUE 'checkin_agent';
  END IF;
END $$;
