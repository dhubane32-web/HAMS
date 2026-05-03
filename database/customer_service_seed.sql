-- Demo customer service cases (idempotent). Run after customer_service.sql + users + at least one booking with passengers.

INSERT INTO cs_service_cases (
  case_ref, case_type, status, priority, passenger_id, booking_id, subject, description, created_by
)
SELECT
  'CS-DEMO-OPEN1',
  'COMPLAINT',
  'OPEN',
  'HIGH',
  sub.passenger_id,
  sub.booking_id,
  'Demo: onboard service feedback',
  'Seeded complaint linked to booking for CS dashboard and history tests.',
  u.id
FROM users u
CROSS JOIN LATERAL (
  SELECT b.id AS booking_id, bp.passenger_id
  FROM bookings b
  JOIN booking_passengers bp ON bp.booking_id = b.id
  WHERE b.pnr = 'BKTOW1'
  LIMIT 1
) sub
WHERE u.email = 'admin@hams.aero'
  AND EXISTS (SELECT 1 FROM bookings WHERE pnr = 'BKTOW1')
  AND NOT EXISTS (SELECT 1 FROM cs_service_cases WHERE case_ref = 'CS-DEMO-OPEN1');

INSERT INTO cs_service_cases (
  case_ref, case_type, status, priority, passenger_id, booking_id, subject, description, created_by
)
SELECT
  'CS-DEMO-PEND1',
  'SUPPORT',
  'IN_PROGRESS',
  'NORMAL',
  sub.passenger_id,
  sub.booking_id,
  'Demo: schedule change inquiry',
  'Seeded in-progress case tied to booking.',
  u.id
FROM users u
CROSS JOIN LATERAL (
  SELECT b.id AS booking_id, bp.passenger_id
  FROM bookings b
  JOIN booking_passengers bp ON bp.booking_id = b.id
  WHERE b.pnr IN ('BKTOW1', 'BKTRTN1', 'FNSEED1')
  ORDER BY CASE WHEN b.pnr = 'BKTRTN1' THEN 0 WHEN b.pnr = 'BKTOW1' THEN 1 ELSE 2 END
  LIMIT 1
) sub
WHERE u.email = 'admin@hams.aero'
  AND EXISTS (SELECT 1 FROM bookings)
  AND NOT EXISTS (SELECT 1 FROM cs_service_cases WHERE case_ref = 'CS-DEMO-PEND1');

INSERT INTO cs_service_cases (
  case_ref, case_type, status, priority, passenger_id, booking_id, subject, description, created_by, closed_at
)
SELECT
  'CS-DEMO-RES1',
  'GENERAL',
  'RESOLVED',
  'LOW',
  sub.passenger_id,
  sub.booking_id,
  'Demo: resolved baggage question',
  'Seeded resolved case for metrics.',
  u.id,
  NOW()
FROM users u
CROSS JOIN LATERAL (
  SELECT b.id AS booking_id, bp.passenger_id
  FROM bookings b
  JOIN booking_passengers bp ON bp.booking_id = b.id
  WHERE b.pnr = 'BKTOW1'
  LIMIT 1
) sub
WHERE u.email = 'admin@hams.aero'
  AND EXISTS (SELECT 1 FROM bookings WHERE pnr = 'BKTOW1')
  AND NOT EXISTS (SELECT 1 FROM cs_service_cases WHERE case_ref = 'CS-DEMO-RES1');

INSERT INTO cs_case_notes (case_id, body, is_internal, created_by)
SELECT c.id, 'Internal: initial triage — passenger prefers email follow-up.', TRUE, u.id
FROM cs_service_cases c
JOIN users u ON u.email = 'admin@hams.aero'
WHERE c.case_ref = 'CS-DEMO-OPEN1'
  AND NOT EXISTS (SELECT 1 FROM cs_case_notes n WHERE n.case_id = c.id AND n.body LIKE '%Internal: initial triage%');
