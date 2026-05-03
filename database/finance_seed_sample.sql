-- Sample finance rows for empty dev DBs (idempotent). Requires booking_ticketing + finance_accounting applied.

INSERT INTO bookings (pnr, booking_status, total_amount, currency, payment_status, created_by)
SELECT 'FNSEED1', 'CONFIRMED', 800.00, 'USD', 'UNPAID', u.id
FROM users u
WHERE u.email = 'admin@hams.aero'
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE pnr = 'FNSEED1')
LIMIT 1;

INSERT INTO bookings (pnr, booking_status, total_amount, currency, payment_status, created_by)
SELECT 'FNSEED2', 'CONFIRMED', 1200.00, 'USD', 'PAID', u.id
FROM users u
WHERE u.email = 'admin@hams.aero'
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE pnr = 'FNSEED2')
LIMIT 1;

INSERT INTO payments (booking_id, payment_type, amount, currency, payment_status, transaction_ref, processed_at, processed_by)
SELECT b.id, 'CARD', 1200.00, 'USD', 'PAID', 'SEED-PAY-1', NOW(), u.id
FROM bookings b
JOIN users u ON u.email = 'admin@hams.aero'
WHERE b.pnr = 'FNSEED2'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id);

UPDATE bookings b
SET payment_status = 'PAID'
WHERE b.pnr = 'FNSEED2'
  AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id);

INSERT INTO finance_expenses (category, amount, currency, incurred_on, description, reference, flight_id, entered_by)
SELECT 'GROUND_HANDLING', 1250.00, 'USD', CURRENT_DATE, 'Seed: ramp and handling (MTD)', 'SEED-FIN-EXP', NULL, sub.id
FROM (SELECT id FROM users WHERE email IN ('admin@hams.aero', 'finance@hams.aero') LIMIT 1) sub
WHERE NOT EXISTS (SELECT 1 FROM finance_expenses WHERE reference = 'SEED-FIN-EXP');

UPDATE finance_expenses SET incurred_on = CURRENT_DATE, description = 'Seed: ramp and handling (MTD)'
WHERE reference = 'SEED-FIN-EXP';
