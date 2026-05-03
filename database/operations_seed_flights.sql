-- Operational flight seed (idempotent). Run after flight_operations.sql (ops_routes + route_id).
-- Ensures: aircraft exist, crew_seed targets HW101/HW205 exist, today's UTC board has flights, route_id backfill.

INSERT INTO aircraft (tail_number, model, seat_capacity, release_status)
VALUES
  ('5Y-HAW', 'Boeing 737-800', 162, 'RELEASED'),
  ('5Y-HAM', 'Airbus A320', 150, 'RELEASED')
ON CONFLICT (tail_number) DO NOTHING;

-- Demo flights referenced by crew_seed_sample.sql: one row each; times refreshed on each run (UTC).
INSERT INTO flights (
  flight_number,
  departure_airport,
  arrival_airport,
  departure_time,
  arrival_time,
  status,
  aircraft_id,
  created_by
)
SELECT
  'HW101',
  'DXB',
  'NBO',
  ((to_char((now() AT TIME ZONE 'utc')::date + interval '1 day', 'YYYY-MM-DD') || ' 03:00:00')::timestamp AT TIME ZONE 'UTC'),
  ((to_char((now() AT TIME ZONE 'utc')::date + interval '1 day', 'YYYY-MM-DD') || ' 08:00:00')::timestamp AT TIME ZONE 'UTC'),
  'SCHEDULED',
  a.id,
  u.id
FROM aircraft a
JOIN users u ON u.email = 'admin@hams.aero'
WHERE a.tail_number = '5Y-HAW'
  AND NOT EXISTS (SELECT 1 FROM flights f WHERE f.flight_number = 'HW101');

UPDATE flights f
SET
  departure_airport = 'DXB',
  arrival_airport = 'NBO',
  departure_time = ((to_char((now() AT TIME ZONE 'utc')::date + interval '1 day', 'YYYY-MM-DD') || ' 03:00:00')::timestamp AT TIME ZONE 'UTC'),
  arrival_time = ((to_char((now() AT TIME ZONE 'utc')::date + interval '1 day', 'YYYY-MM-DD') || ' 08:00:00')::timestamp AT TIME ZONE 'UTC'),
  status = 'SCHEDULED',
  aircraft_id = (SELECT id FROM aircraft WHERE tail_number = '5Y-HAW' LIMIT 1)
WHERE f.flight_number = 'HW101';

INSERT INTO flights (
  flight_number,
  departure_airport,
  arrival_airport,
  departure_time,
  arrival_time,
  status,
  aircraft_id,
  created_by
)
SELECT
  'HW205',
  'NBO',
  'DXB',
  ((to_char((now() AT TIME ZONE 'utc')::date + interval '2 days', 'YYYY-MM-DD') || ' 04:00:00')::timestamp AT TIME ZONE 'UTC'),
  ((to_char((now() AT TIME ZONE 'utc')::date + interval '2 days', 'YYYY-MM-DD') || ' 09:00:00')::timestamp AT TIME ZONE 'UTC'),
  'SCHEDULED',
  a.id,
  u.id
FROM aircraft a
JOIN users u ON u.email = 'admin@hams.aero'
WHERE a.tail_number = '5Y-HAM'
  AND NOT EXISTS (SELECT 1 FROM flights f WHERE f.flight_number = 'HW205');

UPDATE flights f
SET
  departure_airport = 'NBO',
  arrival_airport = 'DXB',
  departure_time = ((to_char((now() AT TIME ZONE 'utc')::date + interval '2 days', 'YYYY-MM-DD') || ' 04:00:00')::timestamp AT TIME ZONE 'UTC'),
  arrival_time = ((to_char((now() AT TIME ZONE 'utc')::date + interval '2 days', 'YYYY-MM-DD') || ' 09:00:00')::timestamp AT TIME ZONE 'UTC'),
  status = 'SCHEDULED',
  aircraft_id = (SELECT id FROM aircraft WHERE tail_number = '5Y-HAM' LIMIT 1)
WHERE f.flight_number = 'HW205';

-- Today's operational board (UTC calendar day)
INSERT INTO flights (
  flight_number,
  departure_airport,
  arrival_airport,
  departure_time,
  arrival_time,
  status,
  aircraft_id,
  route_id,
  gate,
  boarding_time,
  created_by
)
SELECT
  'HWT' || to_char((now() AT TIME ZONE 'utc')::date, 'YYYYMMDD') || '1',
  r.origin_airport,
  r.dest_airport,
  ((to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') || ' 06:30:00')::timestamp AT TIME ZONE 'UTC'),
  ((to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') || ' 13:15:00')::timestamp AT TIME ZONE 'UTC'),
  'SCHEDULED',
  a.id,
  r.id,
  'A12',
  ((to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') || ' 05:45:00')::timestamp AT TIME ZONE 'UTC'),
  u.id
FROM ops_routes r
CROSS JOIN aircraft a
CROSS JOIN users u
WHERE upper(r.origin_airport) = 'NBO' AND upper(r.dest_airport) = 'DXB'
  AND a.tail_number = '5Y-HAW'
  AND u.email = 'admin@hams.aero'
  AND NOT EXISTS (
    SELECT 1 FROM flights f
    WHERE f.flight_number = 'HWT' || to_char((now() AT TIME ZONE 'utc')::date, 'YYYYMMDD') || '1'
  );

INSERT INTO flights (
  flight_number,
  departure_airport,
  arrival_airport,
  departure_time,
  arrival_time,
  status,
  aircraft_id,
  route_id,
  gate,
  boarding_time,
  created_by
)
SELECT
  'HWT' || to_char((now() AT TIME ZONE 'utc')::date, 'YYYYMMDD') || '2',
  r.origin_airport,
  r.dest_airport,
  ((to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') || ' 15:00:00')::timestamp AT TIME ZONE 'UTC'),
  ((to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') || ' 21:30:00')::timestamp AT TIME ZONE 'UTC'),
  'BOARDING',
  a.id,
  r.id,
  'B04',
  ((to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') || ' 14:15:00')::timestamp AT TIME ZONE 'UTC'),
  u.id
FROM ops_routes r
CROSS JOIN aircraft a
CROSS JOIN users u
WHERE upper(r.origin_airport) = 'DXB' AND upper(r.dest_airport) = 'NBO'
  AND a.tail_number = '5Y-HAM'
  AND u.email = 'admin@hams.aero'
  AND NOT EXISTS (
    SELECT 1 FROM flights f
    WHERE f.flight_number = 'HWT' || to_char((now() AT TIME ZONE 'utc')::date, 'YYYYMMDD') || '2'
  );

UPDATE flights f
SET route_id = r.id
FROM ops_routes r
WHERE f.route_id IS NULL
  AND upper(f.departure_airport) = upper(r.origin_airport)
  AND upper(f.arrival_airport) = upper(r.dest_airport)
  AND r.is_active = TRUE;

-- OCC: seed PNRs (e.g. BKTOW1 on HW101) need check-in-eligible flight status
UPDATE flights
SET status = 'CHECKIN_OPEN'
WHERE flight_number IN ('HW101', 'HW205')
  AND UPPER(TRIM(status)) NOT IN ('CANCELLED', 'ARRIVED', 'LANDED');
