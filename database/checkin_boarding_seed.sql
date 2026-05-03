-- Demo check-ins for reports and check-in UI (idempotent).
-- Requires: booking_ticketing_seed (BKTOW1, SEED-BKT-PAX-1, HW101).

INSERT INTO checkins (
  booking_id,
  passenger_id,
  flight_id,
  seat_number,
  boarding_pass_no,
  boarding_status,
  checkin_status,
  boarded_at,
  boarding_gate
)
SELECT
  b.id,
  p.id,
  f.id,
  '12A',
  'BPDEMOBKTOW101',
  'CHECKED_IN',
  'COMPLETED',
  NULL,
  NULLIF(btrim(f.gate::text), '')
FROM bookings b
JOIN passengers p ON p.passport_no = 'SEED-BKT-PAX-1'
JOIN booking_flights bf ON bf.booking_id = b.id
JOIN flights f ON f.id = bf.flight_id AND f.flight_number = 'HW101'
WHERE b.pnr = 'BKTOW1'
  AND NOT EXISTS (
    SELECT 1
    FROM checkins c0
    WHERE c0.booking_id = b.id
      AND c0.passenger_id = p.id
      AND c0.flight_id = f.id
  );
