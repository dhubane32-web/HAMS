-- OCC flight tracking columns (idempotent). Safe if occ_control_center.sql already applied.
ALTER TABLE flights ADD COLUMN IF NOT EXISTS actual_off_block_at TIMESTAMPTZ;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS actual_airborne_at TIMESTAMPTZ;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS actual_landed_at TIMESTAMPTZ;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS eta_current_at TIMESTAMPTZ;
