-- Hawana Airways — Phase 2 commercial + operational demo (idempotent).
-- Routes: MGQ ↔ NBO, HGA, GGR, BSA | Fleet: E190, CRJ700, Dash 8 Q400
-- Run after: schema, master_data, commercial_core_phase2 (006), operations seeds optional.

-- ---------------------------------------------------------------------------
-- Airports (Somalia network + NBO)
-- ---------------------------------------------------------------------------
INSERT INTO md_countries (iso2, name)
VALUES ('SO', 'Somalia'), ('KE', 'Kenya')
ON CONFLICT (iso2) DO NOTHING;

INSERT INTO md_airports (iata_code, name, country_id, timezone)
SELECT v.iata, v.nm, c.id, v.tz
FROM (VALUES
  ('HGA', 'Egal International (Hargeisa)', 'SO', 'Africa/Mogadishu'),
  ('BSA', 'Bosaso / Bender Qassim', 'SO', 'Africa/Mogadishu')
) AS v(iata, nm, iso, tz)
JOIN md_countries c ON c.iso2 = v.iso
ON CONFLICT (iata_code) DO NOTHING;

INSERT INTO md_airports (iata_code, name, country_id, timezone)
SELECT 'MGQ', 'Aden Adde International', c.id, 'Africa/Mogadishu'
FROM md_countries c WHERE c.iso2 = 'SO'
ON CONFLICT (iata_code) DO NOTHING;

INSERT INTO md_airports (iata_code, name, country_id, timezone)
SELECT 'NBO', 'Jomo Kenyatta International', c.id, 'Africa/Nairobi'
FROM md_countries c WHERE c.iso2 = 'KE'
ON CONFLICT (iata_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Aircraft types & Hawana fleet
-- ---------------------------------------------------------------------------
INSERT INTO md_aircraft_types (code, name, default_seat_capacity)
VALUES
  ('E190', 'Embraer E190', 100),
  ('CRJ7', 'Bombardier CRJ700', 70),
  ('DH8Q', 'De Havilland Dash 8 Q400', 78)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, default_seat_capacity = EXCLUDED.default_seat_capacity;

INSERT INTO md_seat_maps (name, aircraft_type_id, layout_json)
SELECT 'E190 Economy 2-2', t.id, '{"rows":25,"economy":"2-2","cabin":"ECONOMY"}'::jsonb
FROM md_aircraft_types t WHERE t.code = 'E190'
  AND NOT EXISTS (SELECT 1 FROM md_seat_maps s WHERE s.aircraft_type_id = t.id AND s.name = 'E190 Economy 2-2');

INSERT INTO aircraft (tail_number, model, seat_capacity, release_status)
VALUES
  ('5Y-HWE', 'Embraer E190', 100, 'RELEASED'),
  ('5Y-HWC', 'Bombardier CRJ700', 70, 'RELEASED'),
  ('5Y-HWQ', 'De Havilland Dash 8 Q400', 78, 'RELEASED')
ON CONFLICT (tail_number) DO UPDATE SET
  model = EXCLUDED.model,
  seat_capacity = EXCLUDED.seat_capacity,
  release_status = 'RELEASED';

UPDATE aircraft a
SET seat_map_id = s.id
FROM md_seat_maps s
JOIN md_aircraft_types t ON t.id = s.aircraft_type_id
WHERE a.tail_number = '5Y-HWE' AND t.code = 'E190' AND a.seat_map_id IS NULL;

-- ---------------------------------------------------------------------------
-- Routes & fares (MGQ hub)
-- ---------------------------------------------------------------------------
INSERT INTO md_routes (origin_airport_id, dest_airport_id, distance_nm, is_active)
SELECT o.id, d.id, v.dist, TRUE
FROM (VALUES
  ('MGQ', 'NBO', 620),
  ('NBO', 'MGQ', 620),
  ('MGQ', 'HGA', 120),
  ('HGA', 'MGQ', 120),
  ('MGQ', 'GGR', 430),
  ('GGR', 'MGQ', 430),
  ('MGQ', 'BSA', 520),
  ('BSA', 'MGQ', 520)
) AS v(orig, dest, dist)
JOIN md_airports o ON o.iata_code = v.orig
JOIN md_airports d ON d.iata_code = v.dest
AND NOT EXISTS (
  SELECT 1 FROM md_routes r2
  WHERE r2.origin_airport_id = o.id AND r2.dest_airport_id = d.id
);

INSERT INTO md_route_fares (route_id, fare_class_id, amount, currency, is_active)
SELECT r.id, f.id, v.amt, 'USD', TRUE
FROM md_routes r
JOIN md_airports o ON o.id = r.origin_airport_id
JOIN md_airports d ON d.id = r.dest_airport_id
JOIN (VALUES
  ('MGQ', 'NBO', 'ECON', 285.00),
  ('MGQ', 'NBO', 'FLEX', 340.00),
  ('NBO', 'MGQ', 'ECON', 285.00),
  ('MGQ', 'HGA', 'ECON', 95.00),
  ('HGA', 'MGQ', 'ECON', 95.00),
  ('MGQ', 'GGR', 'ECON', 125.00),
  ('GGR', 'MGQ', 'ECON', 125.00),
  ('MGQ', 'BSA', 'ECON', 165.00),
  ('BSA', 'MGQ', 'ECON', 165.00)
) AS v(orig, dest, fc, amt) ON o.iata_code = v.orig AND d.iata_code = v.dest
JOIN md_fare_classes f ON f.code = v.fc
ON CONFLICT (route_id, fare_class_id) DO UPDATE SET amount = EXCLUDED.amount, is_active = TRUE;

-- Ops routes mirror (when ops_routes exists)
INSERT INTO ops_routes (origin_airport, dest_airport, is_active)
SELECT v.orig, v.dest, TRUE
FROM (VALUES ('MGQ','NBO'),('NBO','MGQ'),('MGQ','HGA'),('HGA','MGQ'),('MGQ','GGR'),('GGR','MGQ'),('MGQ','BSA'),('BSA','MGQ')) AS v(orig,dest)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ops_routes')
  AND NOT EXISTS (
    SELECT 1 FROM ops_routes r WHERE upper(r.origin_airport) = upper(v.orig) AND upper(r.dest_airport) = upper(v.dest)
  );

-- ---------------------------------------------------------------------------
-- Scheduled flights (UTC — today + tomorrow for desk/OCC)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  admin_id UUID;
  d0 DATE := (now() AT TIME ZONE 'utc')::date;
  d1 DATE := d0 + 1;
BEGIN
  SELECT id INTO admin_id FROM users
  WHERE email IN ('admin@hawanaairways.com', 'admin@hams.aero')
  ORDER BY CASE email WHEN 'admin@hawanaairways.com' THEN 0 ELSE 1 END
  LIMIT 1;

  IF admin_id IS NULL THEN
    RAISE NOTICE 'No admin user — skip Hawana flight seed';
    RETURN;
  END IF;

  -- HW301 MGQ→NBO (E190) — check-in open today
  INSERT INTO flights (flight_number, departure_airport, arrival_airport, departure_time, arrival_time, status, aircraft_id, gate, boarding_time, created_by)
  SELECT 'HW301', 'MGQ', 'NBO',
    (d0::text || ' 05:00:00')::timestamptz,
    (d0::text || ' 07:15:00')::timestamptz,
    'CHECKIN_OPEN', a.id, 'G3', (d0::text || ' 04:15:00')::timestamptz, admin_id
  FROM aircraft a WHERE a.tail_number = '5Y-HWE'
    AND NOT EXISTS (SELECT 1 FROM flights f WHERE f.flight_number = 'HW301');

  UPDATE flights SET
    departure_time = (d0::text || ' 05:00:00')::timestamptz,
    arrival_time = (d0::text || ' 07:15:00')::timestamptz,
    status = 'CHECKIN_OPEN',
    aircraft_id = (SELECT id FROM aircraft WHERE tail_number = '5Y-HWE' LIMIT 1),
    gate = 'G3',
    boarding_time = (d0::text || ' 04:15:00')::timestamptz
  WHERE flight_number = 'HW301';

  -- HW302 MGQ→HGA (CRJ) — delayed demo
  INSERT INTO flights (flight_number, departure_airport, arrival_airport, departure_time, arrival_time, status, aircraft_id, gate, created_by)
  SELECT 'HW302', 'MGQ', 'HGA',
    (d0::text || ' 09:30:00')::timestamptz,
    (d0::text || ' 10:45:00')::timestamptz,
    'DELAYED', a.id, 'G1', admin_id
  FROM aircraft a WHERE a.tail_number = '5Y-HWC'
    AND NOT EXISTS (SELECT 1 FROM flights f WHERE f.flight_number = 'HW302');

  UPDATE flights SET
    departure_time = (d0::text || ' 10:00:00')::timestamptz,
    arrival_time = (d0::text || ' 11:15:00')::timestamptz,
    status = 'DELAYED',
    aircraft_id = (SELECT id FROM aircraft WHERE tail_number = '5Y-HWC' LIMIT 1)
  WHERE flight_number = 'HW302';

  -- HW303 MGQ→GGR (Q400)
  INSERT INTO flights (flight_number, departure_airport, arrival_airport, departure_time, arrival_time, status, aircraft_id, created_by)
  SELECT 'HW303', 'MGQ', 'GGR',
    (d1::text || ' 06:00:00')::timestamptz,
    (d1::text || ' 07:20:00')::timestamptz,
    'SCHEDULED', a.id, admin_id
  FROM aircraft a WHERE a.tail_number = '5Y-HWQ'
    AND NOT EXISTS (SELECT 1 FROM flights f WHERE f.flight_number = 'HW303');

  UPDATE flights SET
    departure_time = (d1::text || ' 06:00:00')::timestamptz,
    arrival_time = (d1::text || ' 07:20:00')::timestamptz,
    status = 'SCHEDULED',
    aircraft_id = (SELECT id FROM aircraft WHERE tail_number = '5Y-HWQ' LIMIT 1)
  WHERE flight_number = 'HW303';

  -- HW304 MGQ→BSA (E190)
  INSERT INTO flights (flight_number, departure_airport, arrival_airport, departure_time, arrival_time, status, aircraft_id, created_by)
  SELECT 'HW304', 'MGQ', 'BSA',
    (d1::text || ' 12:00:00')::timestamptz,
    (d1::text || ' 14:30:00')::timestamptz,
    'SCHEDULED', a.id, admin_id
  FROM aircraft a WHERE a.tail_number = '5Y-HWE'
    AND NOT EXISTS (SELECT 1 FROM flights f WHERE f.flight_number = 'HW304');

  UPDATE flights SET
    departure_time = (d1::text || ' 12:00:00')::timestamptz,
    arrival_time = (d1::text || ' 14:30:00')::timestamptz,
    aircraft_id = (SELECT id FROM aircraft WHERE tail_number = '5Y-HWE' LIMIT 1)
  WHERE flight_number = 'HW304';

  -- Return NBO→MGQ for return booking demo
  INSERT INTO flights (flight_number, departure_airport, arrival_airport, departure_time, arrival_time, status, aircraft_id, created_by)
  SELECT 'HW305', 'NBO', 'MGQ',
    (d1::text || ' 16:00:00')::timestamptz,
    (d1::text || ' 18:15:00')::timestamptz,
    'SCHEDULED', a.id, admin_id
  FROM aircraft a WHERE a.tail_number = '5Y-HWE'
    AND NOT EXISTS (SELECT 1 FROM flights f WHERE f.flight_number = 'HW305');

  UPDATE flights SET
    departure_time = (d1::text || ' 16:00:00')::timestamptz,
    arrival_time = (d1::text || ' 18:15:00')::timestamptz
  WHERE flight_number = 'HW305';
END $$;

-- Route inventory buckets (phase 2)
INSERT INTO route_inventory_control (flight_id, fare_class_id, authorized_seats, sold_seats)
SELECT f.id, NULL, COALESCE(a.seat_capacity, 100), 0
FROM flights f
LEFT JOIN aircraft a ON a.id = f.aircraft_id
WHERE f.flight_number IN ('HW301','HW302','HW303','HW304','HW305')
  AND NOT EXISTS (
    SELECT 1 FROM route_inventory_control ric WHERE ric.flight_id = f.id AND ric.fare_class_id IS NULL
  );

-- ---------------------------------------------------------------------------
-- Passengers (Hawana-branded demo guests)
-- ---------------------------------------------------------------------------
INSERT INTO passengers (first_name, last_name, gender, date_of_birth, nationality, passport_no, passport_expiry, phone, email, emergency_contact)
SELECT 'Amina', 'Hassan', 'F', '1990-04-12', 'SO', 'SO-HW-AMINA-01', '2033-06-01', '+252611000101', 'amina.hassan@hawana.demo', '+252611000102'
WHERE NOT EXISTS (SELECT 1 FROM passengers WHERE passport_no = 'SO-HW-AMINA-01');

INSERT INTO passengers (first_name, last_name, gender, date_of_birth, nationality, passport_no, passport_expiry, phone, email, emergency_contact)
SELECT 'Omar', 'Dirie', 'M', '1985-11-03', 'KE', 'KE-HW-OMAR-01', '2032-12-15', '+254722000201', 'omar.dirie@hawana.demo', '+254722000202'
WHERE NOT EXISTS (SELECT 1 FROM passengers WHERE passport_no = 'KE-HW-OMAR-01');

INSERT INTO passengers (first_name, last_name, gender, date_of_birth, nationality, passport_no, passport_expiry, phone, email)
SELECT 'Fatima', 'Ali', 'F', '1995-08-22', 'SO', 'SO-HW-FATIMA-01', '2034-01-20', '+252611000301', 'fatima.ali@hawana.demo'
WHERE NOT EXISTS (SELECT 1 FROM passengers WHERE passport_no = 'SO-HW-FATIMA-01');

-- Passenger profiles (phase 2)
INSERT INTO passenger_profiles (profile_ref, primary_email, primary_phone, loyalty_tier, travel_history_json)
SELECT 'HW100001', 'amina.hassan@hawana.demo', '+252611000101', 'GOLD', '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM passenger_profiles WHERE profile_ref = 'HW100001');

UPDATE passengers p SET profile_id = pp.id
FROM passenger_profiles pp
WHERE pp.profile_ref = 'HW100001' AND p.passport_no = 'SO-HW-AMINA-01' AND p.profile_id IS NULL;

-- ---------------------------------------------------------------------------
-- Booking HW9K2M — MGQ→NBO one-way, paid, ticketed (HW301)
-- ---------------------------------------------------------------------------
INSERT INTO bookings (
  pnr, trip_type, booking_status, total_amount, currency, payment_status, created_by,
  fare_base_total, fare_tax_total, fare_fee_total, notes, sales_channel_code
)
SELECT
  'HW9K2M', 'ONE_WAY', 'CONFIRMED', 312.00, 'USD', 'PAID', u.id,
  285.00, 14.25, 12.75,
  'Hawana demo: MGQ-NBO commercial seed', 'DIRECT_WEB'
FROM (SELECT id FROM users WHERE email IN ('admin@hawanaairways.com', 'admin@hams.aero') ORDER BY CASE email WHEN 'admin@hawanaairways.com' THEN 0 ELSE 1 END LIMIT 1) u
WHERE EXISTS (SELECT 1 FROM flights WHERE flight_number = 'HW301')
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE pnr = 'HW9K2M');

INSERT INTO booking_passengers (booking_id, passenger_id, passenger_type)
SELECT b.id, p.id, 'ADT'
FROM bookings b, passengers p
WHERE b.pnr = 'HW9K2M' AND p.passport_no = 'SO-HW-AMINA-01'
  AND NOT EXISTS (SELECT 1 FROM booking_passengers bp WHERE bp.booking_id = b.id AND bp.passenger_id = p.id);

INSERT INTO booking_flights (booking_id, flight_id, leg_type, leg_sequence, cabin_class, fare_amount)
SELECT b.id, f.id, 'OUTBOUND', 1, 'ECONOMY', 285.00
FROM bookings b, flights f
WHERE b.pnr = 'HW9K2M' AND f.flight_number = 'HW301'
  AND NOT EXISTS (SELECT 1 FROM booking_flights bf WHERE bf.booking_id = b.id AND bf.flight_id = f.id);

INSERT INTO payments (booking_id, payment_type, amount, currency, payment_status, transaction_ref, processed_by)
SELECT b.id, 'CARD', b.total_amount, b.currency, 'PAID', 'HW-PAY-9K2M-001', b.created_by
FROM bookings b WHERE b.pnr = 'HW9K2M'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.transaction_ref = 'HW-PAY-9K2M-001');

INSERT INTO tickets (ticket_number, booking_id, passenger_id, issued_by, ticket_status)
SELECT '5552405190001', b.id, p.id, b.created_by, 'ISSUED'
FROM bookings b
JOIN booking_passengers bp ON bp.booking_id = b.id
JOIN passengers p ON p.id = bp.passenger_id AND p.passport_no = 'SO-HW-AMINA-01'
WHERE b.pnr = 'HW9K2M'
  AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.ticket_number = '5552405190001');

-- Return booking HW4R7N — MGQ↔GGR
INSERT INTO bookings (pnr, trip_type, booking_status, total_amount, currency, payment_status, created_by, return_date, notes)
SELECT 'HW4R7N', 'RETURN', 'CONFIRMED', 268.00, 'USD', 'PAID', u.id,
  (now() AT TIME ZONE 'utc')::date + 2,
  'Hawana demo: MGQ-GGR return'
FROM (SELECT id FROM users WHERE email IN ('admin@hawanaairways.com', 'admin@hams.aero') ORDER BY CASE email WHEN 'admin@hawanaairways.com' THEN 0 ELSE 1 END LIMIT 1) u
WHERE EXISTS (SELECT 1 FROM flights WHERE flight_number = 'HW303')
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE pnr = 'HW4R7N');

INSERT INTO booking_passengers (booking_id, passenger_id, passenger_type)
SELECT b.id, p.id, 'ADT'
FROM bookings b, passengers p
WHERE b.pnr = 'HW4R7N' AND p.passport_no = 'KE-HW-OMAR-01'
  AND NOT EXISTS (SELECT 1 FROM booking_passengers bp WHERE bp.booking_id = b.id AND bp.passenger_id = p.id);

INSERT INTO booking_flights (booking_id, flight_id, leg_type, leg_sequence, cabin_class, fare_amount)
SELECT b.id, f.id, 'OUTBOUND', 1, 'ECONOMY', 125.00
FROM bookings b, flights f WHERE b.pnr = 'HW4R7N' AND f.flight_number = 'HW303'
  AND NOT EXISTS (SELECT 1 FROM booking_flights bf WHERE bf.booking_id = b.id AND bf.flight_id = f.id);

INSERT INTO tickets (ticket_number, booking_id, passenger_id, issued_by, ticket_status)
SELECT '5552405190002', b.id, p.id, b.created_by, 'ISSUED'
FROM bookings b
JOIN booking_passengers bp ON bp.booking_id = b.id
JOIN passengers p ON p.id = bp.passenger_id AND p.passport_no = 'KE-HW-OMAR-01'
WHERE b.pnr = 'HW4R7N'
  AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.ticket_number = '5552405190002');

-- Refund demo HW8P1C — cancelled after payment
INSERT INTO bookings (pnr, trip_type, booking_status, total_amount, currency, payment_status, created_by, notes)
SELECT 'HW8P1C', 'ONE_WAY', 'CANCELLED', 178.00, 'USD', 'REFUNDED', u.id,
  'Hawana demo: cancelled + refund'
FROM (SELECT id FROM users WHERE email IN ('admin@hawanaairways.com', 'admin@hams.aero') ORDER BY CASE email WHEN 'admin@hawanaairways.com' THEN 0 ELSE 1 END LIMIT 1) u
WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE pnr = 'HW8P1C');

INSERT INTO booking_passengers (booking_id, passenger_id, passenger_type)
SELECT b.id, p.id, 'ADT'
FROM bookings b, passengers p
WHERE b.pnr = 'HW8P1C' AND p.passport_no = 'SO-HW-FATIMA-01'
  AND NOT EXISTS (SELECT 1 FROM booking_passengers bp WHERE bp.booking_id = b.id AND bp.passenger_id = p.id);

INSERT INTO booking_flights (booking_id, flight_id, leg_type, leg_sequence, cabin_class, fare_amount)
SELECT b.id, f.id, 'OUTBOUND', 1, 'ECONOMY', 165.00
FROM bookings b, flights f WHERE b.pnr = 'HW8P1C' AND f.flight_number = 'HW304'
  AND NOT EXISTS (SELECT 1 FROM booking_flights bf WHERE bf.booking_id = b.id AND bf.flight_id = f.id);

INSERT INTO payments (booking_id, payment_type, amount, currency, payment_status, transaction_ref, processed_by)
SELECT b.id, 'CARD', 178.00, 'USD', 'REFUNDED', 'HW-PAY-8P1C-001', b.created_by
FROM bookings b WHERE b.pnr = 'HW8P1C'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id);

INSERT INTO refunds (payment_id, refund_amount, reason, approved_by)
SELECT pay.id, 178.00, 'Schedule change — full refund (demo)', b.created_by
FROM bookings b
JOIN payments pay ON pay.booking_id = b.id AND pay.transaction_ref = 'HW-PAY-8P1C-001'
WHERE b.pnr = 'HW8P1C'
  AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_id = pay.id);

-- SSR / OSI (phase 2)
INSERT INTO booking_ssr (booking_id, passenger_id, flight_id, ssr_code, ssr_text, created_by)
SELECT b.id, p.id, f.id, 'WCHR', 'Wheelchair to gate', b.created_by
FROM bookings b
JOIN passengers p ON p.passport_no = 'SO-HW-AMINA-01'
JOIN booking_flights bf ON bf.booking_id = b.id
JOIN flights f ON f.id = bf.flight_id AND f.flight_number = 'HW301'
WHERE b.pnr = 'HW9K2M'
  AND NOT EXISTS (SELECT 1 FROM booking_ssr s WHERE s.booking_id = b.id AND s.ssr_code = 'WCHR');

INSERT INTO booking_osi (booking_id, osi_line, created_by)
SELECT b.id, 'CTCM +252611000101', b.created_by
FROM bookings b WHERE b.pnr = 'HW9K2M'
  AND NOT EXISTS (SELECT 1 FROM booking_osi o WHERE o.booking_id = b.id AND o.osi_line LIKE 'CTCM%');

-- Ticket coupons
INSERT INTO ticket_coupons (ticket_id, booking_flight_id, coupon_number, coupon_status, fare_amount, tax_amount, currency)
SELECT t.id, bf.id, 1, 'OPEN', bf.fare_amount, 14.25, 'USD'
FROM tickets t
JOIN bookings b ON b.id = t.booking_id AND b.pnr = 'HW9K2M'
JOIN booking_flights bf ON bf.booking_id = b.id
WHERE t.ticket_number = '5552405190001'
ON CONFLICT (ticket_id, booking_flight_id) DO NOTHING;

-- Check-in + boarding pass (HW301 / HW9K2M)
INSERT INTO checkins (booking_id, passenger_id, flight_id, seat_number, boarding_pass_no, boarding_status, checkin_status, boarding_gate)
SELECT b.id, p.id, f.id, '14C', 'HWBP9K2M301', 'CHECKED_IN', 'COMPLETED', COALESCE(f.gate, 'G3')
FROM bookings b
JOIN passengers p ON p.passport_no = 'SO-HW-AMINA-01'
JOIN booking_flights bf ON bf.booking_id = b.id
JOIN flights f ON f.id = bf.flight_id AND f.flight_number = 'HW301'
WHERE b.pnr = 'HW9K2M'
  AND NOT EXISTS (
    SELECT 1 FROM checkins c WHERE c.booking_id = b.id AND c.passenger_id = p.id AND c.flight_id = f.id
  );

INSERT INTO baggage (checkin_id, tag_number, weight_kg, pieces)
SELECT c.id, 'HW3590001401', 18.5, 1
FROM checkins c
JOIN bookings b ON b.id = c.booking_id AND b.pnr = 'HW9K2M'
WHERE c.boarding_pass_no = 'HWBP9K2M301'
  AND NOT EXISTS (SELECT 1 FROM baggage bg WHERE bg.checkin_id = c.id);

-- Delay on HW302 + OCC event
INSERT INTO flight_delays (flight_id, delay_minutes, reason, reported_by, delay_code, operational_notes)
SELECT f.id, 30, 'ATC flow restriction — Mogadishu FIR', u.id, 'ATC', 'Passenger notifications queued (demo)'
FROM flights f
CROSS JOIN users u
WHERE f.flight_number = 'HW302'
  AND u.email IN ('admin@hawanaairways.com', 'admin@hams.aero')
  AND NOT EXISTS (SELECT 1 FROM flight_delays d WHERE d.flight_id = f.id AND d.delay_minutes = 30)
LIMIT 1;

INSERT INTO occ_flight_event (flight_id, event_type, source_system, payload_json, created_by)
SELECT f.id, 'DELAY', 'occ', '{"delayMinutes":30,"code":"ATC","demo":true}'::jsonb, u.id
FROM flights f
CROSS JOIN users u
WHERE f.flight_number = 'HW302'
  AND u.email IN ('admin@hawanaairways.com', 'admin@hams.aero')
  AND NOT EXISTS (
    SELECT 1 FROM occ_flight_event e WHERE e.flight_id = f.id AND e.event_type = 'DELAY'
      AND e.created_at > now() - interval '7 days'
  )
LIMIT 1;

INSERT INTO occ_flight_event (flight_id, event_type, source_system, payload_json, created_by)
SELECT f.id, 'BOOKING_LINK', 'booking', jsonb_build_object('pnr', 'HW9K2M', 'demo', true), u.id
FROM flights f
CROSS JOIN users u
WHERE f.flight_number = 'HW301'
  AND u.email IN ('admin@hawanaairways.com', 'admin@hams.aero')
  AND NOT EXISTS (
    SELECT 1 FROM occ_flight_event e WHERE e.flight_id = f.id AND e.event_type = 'BOOKING_LINK'
      AND e.payload_json->>'pnr' = 'HW9K2M'
  )
LIMIT 1;

-- Crew on HW301 (when crew users exist)
INSERT INTO crew_assignments (flight_id, crew_user_id, duty_role)
SELECT f.id, cu.id, 'Captain'
FROM flights f
CROSS JOIN LATERAL (
  SELECT id FROM users WHERE role = 'crew' AND is_active = TRUE LIMIT 1
) cu
WHERE f.flight_number = 'HW301'
  AND NOT EXISTS (SELECT 1 FROM crew_assignments ca WHERE ca.flight_id = f.id AND ca.duty_role = 'Captain');

-- Finance ledger sample
INSERT INTO finance_transactions (txn_type, amount, currency, booking_id, description, metadata, created_by)
SELECT 'TICKET_ISSUED', NULL, 'USD', b.id, 'Seed ticket HW9K2M', '{"pnr":"HW9K2M","ticket":"5552405190001"}'::jsonb, b.created_by
FROM bookings b WHERE b.pnr = 'HW9K2M'
  AND NOT EXISTS (
    SELECT 1 FROM finance_transactions ft WHERE ft.booking_id = b.id AND ft.txn_type = 'TICKET_ISSUED'
  );

-- Commercial notifications (queued samples)
INSERT INTO commercial_notifications (channel, template_code, recipient, booking_id, status, payload, sent_at)
SELECT 'EMAIL', 'BOOKING_CONFIRM', 'amina.hassan@hawana.demo', b.id, 'SENT',
  jsonb_build_object('pnr', b.pnr, 'route', 'MGQ-NBO'), now() - interval '2 hours'
FROM bookings b WHERE b.pnr = 'HW9K2M'
  AND NOT EXISTS (
    SELECT 1 FROM commercial_notifications n WHERE n.booking_id = b.id AND n.template_code = 'BOOKING_CONFIRM'
  );

INSERT INTO commercial_notifications (channel, template_code, recipient, flight_id, status, payload)
SELECT 'EMAIL', 'DELAY_ALERT', 'omar.dirie@hawana.demo', f.id, 'QUEUED',
  jsonb_build_object('flight', 'HW302', 'delayMinutes', 30)
FROM flights f WHERE f.flight_number = 'HW302'
  AND NOT EXISTS (
    SELECT 1 FROM commercial_notifications n WHERE n.flight_id = f.id AND n.template_code = 'DELAY_ALERT'
  );

UPDATE route_inventory_control ric
SET sold_seats = sub.cnt
FROM (
  SELECT bf.flight_id, COUNT(DISTINCT bp.passenger_id)::int AS cnt
  FROM booking_flights bf
  JOIN bookings b ON b.id = bf.booking_id AND upper(b.booking_status) <> 'CANCELLED'
  JOIN booking_passengers bp ON bp.booking_id = b.id
  GROUP BY bf.flight_id
) sub
WHERE ric.flight_id = sub.flight_id AND ric.fare_class_id IS NULL;
