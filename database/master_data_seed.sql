-- Seed master data for HAMS (idempotent). Run after master_data.sql.

INSERT INTO md_countries (iso2, name)
VALUES
  ('AE', 'United Arab Emirates'),
  ('KE', 'Kenya'),
  ('SO', 'Somalia'),
  ('DJ', 'Djibouti')
ON CONFLICT (iso2) DO NOTHING;

INSERT INTO md_currencies (code, name, decimal_places)
VALUES ('USD', 'US Dollar', 2), ('KES', 'Kenyan Shilling', 2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_airports (iata_code, name, country_id, timezone)
SELECT 'DXB', 'Dubai International', c.id, 'Asia/Dubai'
FROM md_countries c WHERE c.iso2 = 'AE'
ON CONFLICT (iata_code) DO NOTHING;

INSERT INTO md_airports (iata_code, name, country_id, timezone)
SELECT 'NBO', 'Jomo Kenyatta International', c.id, 'Africa/Nairobi'
FROM md_countries c WHERE c.iso2 = 'KE'
ON CONFLICT (iata_code) DO NOTHING;

INSERT INTO md_airports (iata_code, name, country_id, timezone)
SELECT 'MGQ', 'Aden Adde International', c.id, 'Africa/Mogadishu'
FROM md_countries c WHERE c.iso2 = 'SO'
ON CONFLICT (iata_code) DO NOTHING;

INSERT INTO md_airports (iata_code, name, country_id, timezone)
SELECT 'JIB', 'Djibouti–Ambouli International', c.id, 'Africa/Djibouti'
FROM md_countries c WHERE c.iso2 = 'DJ'
ON CONFLICT (iata_code) DO NOTHING;

INSERT INTO md_airports (iata_code, name, country_id, timezone)
SELECT 'GGR', 'Garowe International', c.id, 'Africa/Mogadishu'
FROM md_countries c WHERE c.iso2 = 'SO'
ON CONFLICT (iata_code) DO NOTHING;

INSERT INTO md_aircraft_types (code, name, default_seat_capacity)
VALUES ('B738', 'Boeing 737-800', 162), ('A320', 'Airbus A320', 150)
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_seat_maps (name, aircraft_type_id, layout_json)
SELECT 'B738 Default', t.id, '{"rows":28,"economy":"3-3"}'::jsonb
FROM md_aircraft_types t
WHERE t.code = 'B738'
  AND NOT EXISTS (SELECT 1 FROM md_seat_maps s WHERE s.aircraft_type_id = t.id);

INSERT INTO md_fare_classes (code, name, booking_class, description)
VALUES
  ('ECON', 'Economy', 'ECONOMY', 'Standard economy fare'),
  ('FLEX', 'Economy Flex', 'ECONOMY', 'Change-friendly economy'),
  ('BUS', 'Business', 'BUSINESS', 'Business cabin')
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_routes (origin_airport_id, dest_airport_id, distance_nm)
SELECT o.id, d.id, 2200
FROM md_airports o, md_airports d
WHERE o.iata_code = 'DXB' AND d.iata_code = 'NBO'
AND NOT EXISTS (
  SELECT 1 FROM md_routes r
  WHERE r.origin_airport_id = o.id AND r.dest_airport_id = d.id
);

INSERT INTO md_routes (origin_airport_id, dest_airport_id, distance_nm)
SELECT o.id, d.id, 2200
FROM md_airports o, md_airports d
WHERE o.iata_code = 'NBO' AND d.iata_code = 'DXB'
AND NOT EXISTS (
  SELECT 1 FROM md_routes r
  WHERE r.origin_airport_id = o.id AND r.dest_airport_id = d.id
);

INSERT INTO md_routes (origin_airport_id, dest_airport_id, distance_nm)
SELECT o.id, d.id, 450
FROM md_airports o, md_airports d
WHERE o.iata_code = 'MGQ' AND d.iata_code = 'JIB'
AND NOT EXISTS (
  SELECT 1 FROM md_routes r
  WHERE r.origin_airport_id = o.id AND r.dest_airport_id = d.id
);

INSERT INTO md_routes (origin_airport_id, dest_airport_id, distance_nm)
SELECT o.id, d.id, 450
FROM md_airports o, md_airports d
WHERE o.iata_code = 'JIB' AND d.iata_code = 'MGQ'
AND NOT EXISTS (
  SELECT 1 FROM md_routes r
  WHERE r.origin_airport_id = o.id AND r.dest_airport_id = d.id
);

INSERT INTO md_routes (origin_airport_id, dest_airport_id, distance_nm, is_active)
SELECT o.id, d.id, 430, TRUE
FROM md_airports o, md_airports d
WHERE o.iata_code = 'MGQ' AND d.iata_code = 'GGR'
AND NOT EXISTS (
  SELECT 1 FROM md_routes r
  WHERE r.origin_airport_id = o.id AND r.dest_airport_id = d.id
);

-- Base fares per sector and fare class (USD). Taxes/fees applied in computeItineraryPricing.
INSERT INTO md_route_fares (route_id, fare_class_id, amount, currency)
SELECT r.id, f.id, v.amount, 'USD'
FROM md_routes r
JOIN md_airports o ON o.id = r.origin_airport_id
JOIN md_airports d ON d.id = r.dest_airport_id
JOIN (VALUES
  ('DXB', 'NBO', 'ECON', 220.00),
  ('DXB', 'NBO', 'FLEX', 285.00),
  ('DXB', 'NBO', 'BUS', 540.00),
  ('NBO', 'DXB', 'ECON', 220.00),
  ('NBO', 'DXB', 'FLEX', 285.00),
  ('NBO', 'DXB', 'BUS', 540.00),
  ('MGQ', 'JIB', 'ECON', 195.00),
  ('MGQ', 'JIB', 'FLEX', 255.00),
  ('MGQ', 'JIB', 'BUS', 495.00),
  ('JIB', 'MGQ', 'ECON', 195.00),
  ('JIB', 'MGQ', 'FLEX', 255.00),
  ('JIB', 'MGQ', 'BUS', 495.00),
  ('MGQ', 'GGR', 'ECON', 125.00),
  ('MGQ', 'GGR', 'FLEX', 165.00),
  ('MGQ', 'GGR', 'BUS', 310.00)
) AS v(orig, dest, fc, amount)
  ON o.iata_code = v.orig AND d.iata_code = v.dest
JOIN md_fare_classes f ON f.code = v.fc
ON CONFLICT (route_id, fare_class_id) DO UPDATE SET
  amount = EXCLUDED.amount,
  currency = EXCLUDED.currency,
  is_active = TRUE;

INSERT INTO md_tax_settings (code, name, rate_percent, applies_to, sort_order)
VALUES ('VAT', 'Value added tax', 5.0, 'SUBTOTAL', 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_fee_settings (code, name, amount_fixed, rate_percent)
VALUES ('YQ', 'Carrier fuel surcharge', 15.00, 0)
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_fee_settings (code, name, amount_fixed, rate_percent)
VALUES ('PSF', 'Passenger service charge', 8.00, 0)
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_payment_methods (code, name)
VALUES ('CARD', 'Credit / debit card'), ('CASH', 'Cash'), ('WALLET', 'Agency wallet')
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_baggage_rules (route_id, fare_class_id, free_pieces, free_weight_kg, max_weight_per_piece_kg, charge_per_kg_over, currency)
SELECT r.id, NULL, 1, 23, 32, 12.00, 'USD'
FROM md_routes r
JOIN md_airports o ON o.id = r.origin_airport_id
JOIN md_airports d ON d.id = r.dest_airport_id
WHERE (o.iata_code, d.iata_code) IN (('DXB','NBO'),('NBO','DXB'),('MGQ','JIB'),('JIB','MGQ'),('MGQ','GGR'))
AND NOT EXISTS (SELECT 1 FROM md_baggage_rules b WHERE b.route_id = r.id AND b.fare_class_id IS NULL);

INSERT INTO md_departments (code, name)
VALUES ('OPS', 'Operations'), ('COMM', 'Commercial')
ON CONFLICT (code) DO NOTHING;

INSERT INTO md_role_definitions (role_key, display_name, description)
SELECT v.role::user_role, v.label, v.role_description
FROM (VALUES
  ('admin'::user_role, 'Administrator', 'Full system access'),
  ('finance'::user_role, 'Finance', 'Payments and accounting'),
  ('operations'::user_role, 'Operations', 'Flights and dispatch'),
  ('agent'::user_role, 'Agent', 'Bookings and check-in'),
  ('crew'::user_role, 'Crew', 'Rostered flying duties'),
  ('maintenance'::user_role, 'Maintenance', 'Aircraft defects and release')
) AS v(role, label, role_description)
ON CONFLICT (role_key) DO UPDATE SET display_name = EXCLUDED.display_name, description = EXCLUDED.description, updated_at = NOW();

INSERT INTO md_system_preferences (pref_key, pref_value, value_type)
VALUES
  ('default_currency', 'USD', 'STRING'),
  ('booking_hold_minutes', '30', 'NUMBER'),
  ('checkin_opens_hours_before', '24', 'NUMBER')
ON CONFLICT (pref_key) DO UPDATE SET pref_value = EXCLUDED.pref_value, updated_at = NOW();

INSERT INTO md_cities (country_id, name)
SELECT c.id, 'Dubai' FROM md_countries c WHERE c.iso2 = 'AE'
AND NOT EXISTS (SELECT 1 FROM md_cities x JOIN md_countries c2 ON x.country_id = c2.id WHERE c2.iso2 = 'AE' AND x.name = 'Dubai');

INSERT INTO md_cities (country_id, name)
SELECT c.id, 'Nairobi' FROM md_countries c WHERE c.iso2 = 'KE'
AND NOT EXISTS (SELECT 1 FROM md_cities x JOIN md_countries c2 ON x.country_id = c2.id WHERE c2.iso2 = 'KE' AND x.name = 'Nairobi');
