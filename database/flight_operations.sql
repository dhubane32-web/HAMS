-- Flight & operations: routes, flight lifecycle statuses, cancellation audit. Run after schema.sql.

CREATE TABLE IF NOT EXISTS ops_routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin_airport VARCHAR(10) NOT NULL,
  dest_airport VARCHAR(10) NOT NULL,
  label VARCHAR(160),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_routes_od_uidx ON ops_routes (upper(origin_airport), upper(dest_airport));

ALTER TABLE flights
  ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES ops_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gate VARCHAR(10),
  ADD COLUMN IF NOT EXISTS boarding_time TIMESTAMPTZ;

UPDATE flights SET status = 'ARRIVED' WHERE UPPER(TRIM(status)) = 'LANDED';

UPDATE flights SET status = 'SCHEDULED'
WHERE UPPER(TRIM(status)) NOT IN (
  'SCHEDULED','CHECKIN_OPEN','BOARDING','GATE_CLOSED','DEPARTED','IN_AIR','ARRIVED','DELAYED','CANCELLED'
);

UPDATE flights SET status = 'DEPARTED' WHERE UPPER(TRIM(status)) = 'DISPATCHED';

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

INSERT INTO ops_routes (origin_airport, dest_airport, label)
SELECT 'NBO', 'DXB', 'Nairobi – Dubai'
WHERE NOT EXISTS (
  SELECT 1 FROM ops_routes r WHERE upper(r.origin_airport) = upper('NBO') AND upper(r.dest_airport) = upper('DXB')
);
INSERT INTO ops_routes (origin_airport, dest_airport, label)
SELECT 'DXB', 'NBO', 'Dubai – Nairobi'
WHERE NOT EXISTS (
  SELECT 1 FROM ops_routes r WHERE upper(r.origin_airport) = upper('DXB') AND upper(r.dest_airport) = upper('NBO')
);
INSERT INTO ops_routes (origin_airport, dest_airport, label)
SELECT 'MGQ', 'JIB', 'Mogadishu – Djibouti'
WHERE NOT EXISTS (
  SELECT 1 FROM ops_routes r WHERE upper(r.origin_airport) = upper('MGQ') AND upper(r.dest_airport) = upper('JIB')
);
