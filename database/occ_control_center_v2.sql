-- OCC v2: duty-time policy display + extra delay codes (idempotent).
-- If OCC Hub shows missing occ_duty_limit_config, apply with:
--   bash backend/scripts/apply-occ-migrations.sh
-- (requires DATABASE_URL) or run this file after occ_control_center.sql.

CREATE TABLE IF NOT EXISTS occ_duty_limit_config (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  max_block_minutes INT NOT NULL DEFAULT 600 CHECK (max_block_minutes > 0),
  min_rest_minutes INT NOT NULL DEFAULT 600 CHECK (min_rest_minutes > 0),
  max_duty_day_minutes INT NOT NULL DEFAULT 840 CHECK (max_duty_day_minutes > 0),
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO occ_duty_limit_config (id, notes)
VALUES (1, 'Display limits for crew legality checks; adjust per Hawana regulatory approval.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO occ_delay_code_ref (code, label, default_cost_usd) VALUES
  ('RT', 'Ramp / tow', 150),
  ('CF', 'Crew flight time / rest', 400),
  ('IT', 'IT / systems', 250),
  ('FU', 'Fuel / uplift', 180),
  ('LB', 'Load / balance', 120)
ON CONFLICT (code) DO NOTHING;
