-- Sample bookings with passengers, legs, and payments (idempotent). Run after operations_seed_flights + booking_ticketing.
-- Requires: users (admin@hams.aero), flights HW101 / HW205 from operations seed.

-- Align with older DBs that created `passengers` before optional profile columns existed.
ALTER TABLE passengers
  ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS nationality VARCHAR(80),
  ADD COLUMN IF NOT EXISTS passport_no VARCHAR(50),
  ADD COLUMN IF NOT EXISTS passport_expiry DATE,
  ADD COLUMN IF NOT EXISTS phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS email VARCHAR(150),
  ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(150);

-- Legacy `bookings` / legs (some DBs predate core ticketing columns).
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS trip_type VARCHAR(20) NOT NULL DEFAULT 'ONE_WAY',
  ADD COLUMN IF NOT EXISTS booking_status VARCHAR(20) NOT NULL DEFAULT 'HOLD',
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS return_date DATE,
  ADD COLUMN IF NOT EXISTS fare_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS fare_base_total NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS fare_tax_total NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS fare_fee_total NUMERIC(12, 2);

ALTER TABLE booking_flights
  ADD COLUMN IF NOT EXISTS leg_type VARCHAR(10) NOT NULL DEFAULT 'OUTBOUND',
  ADD COLUMN IF NOT EXISTS cabin_class VARCHAR(20) NOT NULL DEFAULT 'ECONOMY',
  ADD COLUMN IF NOT EXISTS fare_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE booking_passengers
  ADD COLUMN IF NOT EXISTS passenger_type VARCHAR(10) NOT NULL DEFAULT 'ADT';

INSERT INTO passengers (
  first_name, last_name, gender, date_of_birth, nationality, passport_no, passport_expiry, phone, email, emergency_contact
)
SELECT 'Demo', 'Passenger', 'M', '1992-06-15', 'KE', 'SEED-BKT-PAX-1', '2032-01-01', '+254700111001', 'demo.passenger@hams.test', '+254700111002'
WHERE NOT EXISTS (SELECT 1 FROM passengers WHERE passport_no = 'SEED-BKT-PAX-1');

INSERT INTO passengers (
  first_name, last_name, gender, date_of_birth, nationality, passport_no, passport_expiry, phone, email, emergency_contact
)
SELECT 'Return', 'Guest', 'F', '1988-03-20', 'KE', 'SEED-BKT-PAX-2', '2031-06-01', '+254700111003', 'return.guest@hams.test', '+254700111004'
WHERE NOT EXISTS (SELECT 1 FROM passengers WHERE passport_no = 'SEED-BKT-PAX-2');

-- One-way sample (linked to HW101 when present)
INSERT INTO bookings (
  pnr, trip_type, booking_status, total_amount, currency, payment_status, created_by,
  return_date, fare_breakdown, fare_base_total, fare_tax_total, fare_fee_total, notes
)
SELECT
  'BKTOW1',
  'ONE_WAY',
  'CONFIRMED',
  520.00,
  'USD',
  'PAID',
  u.id,
  NULL,
  '{"version":1,"baseSubtotal":480,"taxes":25,"fees":15,"promoDiscount":0,"total":520,"lines":[{"code":"BASE","label":"Base fare","amount":480},{"code":"TAX","label":"Taxes","amount":25},{"code":"FEE","label":"Fees","amount":15}]}'::jsonb,
  480.00,
  25.00,
  15.00,
  'Seed: one-way booking with full graph.'
FROM users u
WHERE u.email = 'admin@hams.aero'
  AND EXISTS (SELECT 1 FROM flights WHERE flight_number = 'HW101')
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE pnr = 'BKTOW1');

INSERT INTO booking_passengers (booking_id, passenger_id, passenger_type)
SELECT b.id, p.id, 'ADT'
FROM bookings b
JOIN passengers p ON p.passport_no = 'SEED-BKT-PAX-1'
WHERE b.pnr = 'BKTOW1'
  AND NOT EXISTS (SELECT 1 FROM booking_passengers bp WHERE bp.booking_id = b.id AND bp.passenger_id = p.id);

INSERT INTO booking_flights (booking_id, flight_id, leg_type, cabin_class, fare_amount)
SELECT b.id, f.id, 'OUTBOUND', 'ECONOMY', 480.00
FROM bookings b
JOIN flights f ON f.flight_number = 'HW101'
WHERE b.pnr = 'BKTOW1'
  AND NOT EXISTS (SELECT 1 FROM booking_flights bf WHERE bf.booking_id = b.id AND bf.flight_id = f.id);

INSERT INTO payments (booking_id, payment_type, amount, currency, payment_status, transaction_ref, processed_at, processed_by)
SELECT b.id, 'CARD', 520.00, 'USD', 'PAID', 'SEED-BKTOW1-PAY', NOW(), u.id
FROM bookings b
JOIN users u ON u.email = 'admin@hams.aero'
WHERE b.pnr = 'BKTOW1'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id);

UPDATE bookings b SET payment_status = 'PAID' WHERE b.pnr = 'BKTOW1';

INSERT INTO tickets (ticket_number, booking_id, passenger_id, issued_by, ticket_status)
SELECT '555SEEDBKTOW01', b.id, p.id, u.id, 'ISSUED'
FROM bookings b
JOIN booking_passengers bp ON bp.booking_id = b.id
JOIN passengers p ON p.id = bp.passenger_id AND p.passport_no = 'SEED-BKT-PAX-1'
JOIN users u ON u.email = 'admin@hams.aero'
WHERE b.pnr = 'BKTOW1'
  AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.ticket_number = '555SEEDBKTOW01');

-- Return trip sample (HW101 outbound + HW205 inbound)
INSERT INTO bookings (
  pnr, trip_type, booking_status, total_amount, currency, payment_status, created_by,
  return_date, fare_breakdown, fare_base_total, fare_tax_total, fare_fee_total, notes
)
SELECT
  'BKTRTN1',
  'RETURN',
  'CONFIRMED',
  980.00,
  'USD',
  'UNPAID',
  u.id,
  (SELECT (f2.departure_time AT TIME ZONE 'UTC')::date FROM flights f2 WHERE f2.flight_number = 'HW205' LIMIT 1),
  '{"version":1,"baseSubtotal":900,"taxes":50,"fees":30,"promoDiscount":0,"total":980,"lines":[{"code":"BASE_OUT","label":"Outbound base","amount":450},{"code":"BASE_IN","label":"Inbound base","amount":450},{"code":"TAX","label":"Taxes","amount":50},{"code":"FEE","label":"Fees","amount":30}]}'::jsonb,
  900.00,
  50.00,
  30.00,
  'Seed: return trip — payment pending for workflow demo.'
FROM users u
WHERE u.email = 'admin@hams.aero'
  AND EXISTS (SELECT 1 FROM flights WHERE flight_number = 'HW101')
  AND EXISTS (SELECT 1 FROM flights WHERE flight_number = 'HW205')
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE pnr = 'BKTRTN1');

INSERT INTO booking_passengers (booking_id, passenger_id, passenger_type)
SELECT b.id, p.id, 'ADT'
FROM bookings b
JOIN passengers p ON p.passport_no = 'SEED-BKT-PAX-2'
WHERE b.pnr = 'BKTRTN1'
  AND NOT EXISTS (SELECT 1 FROM booking_passengers bp WHERE bp.booking_id = b.id AND bp.passenger_id = p.id);

INSERT INTO booking_flights (booking_id, flight_id, leg_type, cabin_class, fare_amount)
SELECT b.id, f.id, 'OUTBOUND', 'ECONOMY', 450.00
FROM bookings b
JOIN flights f ON f.flight_number = 'HW101'
WHERE b.pnr = 'BKTRTN1'
  AND NOT EXISTS (SELECT 1 FROM booking_flights bf WHERE bf.booking_id = b.id AND bf.flight_id = f.id);

INSERT INTO booking_flights (booking_id, flight_id, leg_type, cabin_class, fare_amount)
SELECT b.id, f.id, 'INBOUND', 'ECONOMY', 450.00
FROM bookings b
JOIN flights f ON f.flight_number = 'HW205'
WHERE b.pnr = 'BKTRTN1'
  AND NOT EXISTS (SELECT 1 FROM booking_flights bf WHERE bf.booking_id = b.id AND bf.flight_id = f.id);

INSERT INTO payments (booking_id, payment_type, amount, currency, payment_status, transaction_ref, processed_at, processed_by)
SELECT b.id, 'CARD', 980.00, 'USD', 'PENDING', 'SEED-BKTRTN1-PEND', NOW(), u.id
FROM bookings b
JOIN users u ON u.email = 'admin@hams.aero'
WHERE b.pnr = 'BKTRTN1'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id);

UPDATE bookings SET payment_status = 'PENDING' WHERE pnr = 'BKTRTN1';

-- Enrich FNSEED* finance stubs with a passenger + leg when flights exist (optional list completeness)
INSERT INTO passengers (
  first_name, last_name, gender, date_of_birth, nationality, passport_no, passport_expiry, phone, email, emergency_contact
)
SELECT 'Finance', 'Seed Pax', 'M', '1991-01-01', 'AE', 'SEED-FN-PAX-1', '2033-01-01', '+971500000001', 'fnseed.pax@hams.test', '+971500000002'
WHERE NOT EXISTS (SELECT 1 FROM passengers WHERE passport_no = 'SEED-FN-PAX-1');

INSERT INTO booking_passengers (booking_id, passenger_id, passenger_type)
SELECT b.id, p.id, 'ADT'
FROM bookings b
JOIN passengers p ON p.passport_no = 'SEED-FN-PAX-1'
WHERE b.pnr = 'FNSEED1'
  AND EXISTS (SELECT 1 FROM flights WHERE flight_number = 'HW101')
  AND NOT EXISTS (SELECT 1 FROM booking_passengers bp WHERE bp.booking_id = b.id AND bp.passenger_id = p.id);

INSERT INTO booking_flights (booking_id, flight_id, leg_type, cabin_class, fare_amount)
SELECT b.id, f.id, 'OUTBOUND', 'ECONOMY', 800.00
FROM bookings b
JOIN flights f ON f.flight_number = 'HW101'
WHERE b.pnr = 'FNSEED1'
  AND NOT EXISTS (SELECT 1 FROM booking_flights bf WHERE bf.booking_id = b.id);

UPDATE bookings SET trip_type = 'ONE_WAY', return_date = NULL WHERE pnr = 'FNSEED1' AND return_date IS NULL;

INSERT INTO booking_passengers (booking_id, passenger_id, passenger_type)
SELECT b.id, p.id, 'ADT'
FROM bookings b
JOIN passengers p ON p.passport_no = 'SEED-FN-PAX-1'
WHERE b.pnr = 'FNSEED2'
  AND EXISTS (SELECT 1 FROM flights WHERE flight_number = 'HW101')
  AND NOT EXISTS (SELECT 1 FROM booking_passengers bp WHERE bp.booking_id = b.id AND bp.passenger_id = p.id);

INSERT INTO booking_flights (booking_id, flight_id, leg_type, cabin_class, fare_amount)
SELECT b.id, f.id, 'OUTBOUND', 'ECONOMY', 1200.00
FROM bookings b
JOIN flights f ON f.flight_number = 'HW101'
WHERE b.pnr = 'FNSEED2'
  AND NOT EXISTS (SELECT 1 FROM booking_flights bf WHERE bf.booking_id = b.id);

UPDATE bookings SET trip_type = 'ONE_WAY', return_date = NULL WHERE pnr = 'FNSEED2' AND return_date IS NULL;

-- When there are zero bookings (e.g. flights/users prerequisites blocked other inserts), add a minimal row for API smoke tests.
INSERT INTO bookings (pnr, trip_type, booking_status, total_amount, currency, payment_status, created_by, notes)
SELECT 'BKEMPTY1', 'ONE_WAY', 'HOLD', 0.00, 'USD', 'UNPAID', u.id, 'Seed: placeholder when no other bookings exist.'
FROM users u
WHERE u.email = 'admin@hams.aero'
  AND NOT EXISTS (SELECT 1 FROM bookings)
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE pnr = 'BKEMPTY1');
