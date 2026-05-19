-- Enterprise flight ops demo seed (idempotent). Run after flight_ops_enterprise.sql / migration 005.
-- Creates schedule templates, today's flights, rotations, dispatch draft, turnaround steps, sample alert.

-- Schedule templates
INSERT INTO flight_schedules (
  schedule_code, flight_number, origin_airport, dest_airport,
  scheduled_dep_time, scheduled_arr_time, recurrence_type, days_of_week,
  effective_from, schedule_status, notes
)
SELECT 'DEMO-NBO-DXB', 'HW301', 'NBO', 'DXB', '06:00'::time, '10:30'::time, 'DAILY', '{}'::smallint[],
       (now() AT TIME ZONE 'utc')::date - 30, 'ACTIVE', 'Demo eastbound'
WHERE NOT EXISTS (SELECT 1 FROM flight_schedules WHERE schedule_code = 'DEMO-NBO-DXB');

INSERT INTO flight_schedules (
  schedule_code, flight_number, origin_airport, dest_airport,
  scheduled_dep_time, scheduled_arr_time, recurrence_type, days_of_week,
  effective_from, schedule_status, notes
)
SELECT 'DEMO-DXB-NBO', 'HW302', 'DXB', 'NBO', '12:00'::time, '16:30'::time, 'DAILY', '{}'::smallint[],
       (now() AT TIME ZONE 'utc')::date - 30, 'ACTIVE', 'Demo westbound'
WHERE NOT EXISTS (SELECT 1 FROM flight_schedules WHERE schedule_code = 'DEMO-DXB-NBO');

-- Today's flights (UTC ops day) linked to schedules when possible
INSERT INTO flights (
  flight_number, departure_airport, arrival_airport, departure_time, arrival_time,
  status, aircraft_id, schedule_id, created_by
)
SELECT
  'HW301', 'NBO', 'DXB',
  ((to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') || ' 06:00:00')::timestamp AT TIME ZONE 'UTC'),
  ((to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') || ' 10:30:00')::timestamp AT TIME ZONE 'UTC'),
  'SCHEDULED', a.id, s.id, u.id
FROM aircraft a
CROSS JOIN users u
LEFT JOIN flight_schedules s ON s.schedule_code = 'DEMO-NBO-DXB'
WHERE a.tail_number = '5Y-HAW'
  AND u.email IN ('admin@hawanaairways.com', 'admin@hams.aero')
  AND NOT EXISTS (
    SELECT 1 FROM flights f
    WHERE f.flight_number = 'HW301'
      AND (f.departure_time AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'utc')::date
  );

INSERT INTO flights (
  flight_number, departure_airport, arrival_airport, departure_time, arrival_time,
  status, aircraft_id, schedule_id, created_by
)
SELECT
  'HW302', 'DXB', 'NBO',
  ((to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') || ' 14:00:00')::timestamp AT TIME ZONE 'UTC'),
  ((to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') || ' 18:30:00')::timestamp AT TIME ZONE 'UTC'),
  'SCHEDULED', a.id, s.id, u.id
FROM aircraft a
CROSS JOIN users u
LEFT JOIN flight_schedules s ON s.schedule_code = 'DEMO-DXB-NBO'
WHERE a.tail_number = '5Y-HAM'
  AND u.email IN ('admin@hawanaairways.com', 'admin@hams.aero')
  AND NOT EXISTS (
    SELECT 1 FROM flights f
    WHERE f.flight_number = 'HW302'
      AND (f.departure_time AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'utc')::date
  );

-- Aircraft assignments audit rows for today's demo flights
INSERT INTO aircraft_assignments (flight_id, aircraft_id, assignment_status, auto_assigned, assigned_by)
SELECT f.id, f.aircraft_id, 'ASSIGNED', TRUE, u.id
FROM flights f
JOIN users u ON u.email IN ('admin@hawanaairways.com', 'admin@hams.aero')
WHERE f.flight_number IN ('HW301', 'HW302')
  AND (f.departure_time AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'utc')::date
  AND f.aircraft_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM aircraft_assignments aa WHERE aa.flight_id = f.id);

-- Dispatch release draft for HW301
INSERT INTO dispatch_releases (flight_id, release_number, release_status, dispatcher_id, checklist_json, fuel_plan_json)
SELECT f.id,
       'DR-HW301-DEMO',
       'DRAFT',
       u.id,
       '{"aircraftRelease":true,"crewRelease":true,"weatherOk":true,"notamOk":true,"fuelPlanOk":false,"captainApproval":false,"dispatcherApproval":false}'::jsonb,
       '{"tripFuelKg":4200,"reserveKg":900,"taxiKg":200}'::jsonb
FROM flights f
JOIN users u ON u.email IN ('admin@hawanaairways.com', 'admin@hams.aero')
WHERE f.flight_number = 'HW301'
  AND (f.departure_time AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'utc')::date
  AND NOT EXISTS (
    SELECT 1 FROM dispatch_releases dr
    WHERE dr.flight_id = f.id AND dr.release_status IN ('DRAFT', 'PENDING_APPROVAL', 'RELEASED')
  );

-- Turnaround events for HW302 (on ground)
INSERT INTO turnaround_events (flight_id, station_code, event_type, event_status, planned_at, sort_order)
SELECT f.id, f.departure_airport, step, 'PENDING',
       f.arrival_time + (ord * interval '8 minutes'), ord
FROM flights f
CROSS JOIN (
  VALUES
    ('ARRIVAL', 0), ('CLEANING', 1), ('CATERING', 2), ('FUELING', 3), ('BOARDING', 4),
    ('BAGGAGE', 5), ('TECHNICAL', 6), ('GATE', 7), ('READY', 8), ('DEPARTURE', 9)
) AS t(step, ord)
WHERE f.flight_number = 'HW302'
  AND (f.departure_time AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'utc')::date
  AND NOT EXISTS (SELECT 1 FROM turnaround_events te WHERE te.flight_id = f.id);

-- Sample operational alert
INSERT INTO operational_alerts (alert_type, severity, flight_id, message, alert_status)
SELECT 'DISPATCH_QUEUE', 'WARNING', f.id, 'HW301 dispatch release pending approval', 'OPEN'
FROM flights f
WHERE f.flight_number = 'HW301'
  AND (f.departure_time AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'utc')::date
  AND NOT EXISTS (
    SELECT 1 FROM operational_alerts oa
    WHERE oa.flight_id = f.id AND oa.alert_type = 'DISPATCH_QUEUE' AND oa.alert_status = 'OPEN'
  );
