-- Password hash below corresponds to: Admin123!
-- Generated using bcrypt.

INSERT INTO users (full_name, email, password_hash, role)
VALUES
  ('Hawana Airways Admin', 'admin@hams.aero', '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa', 'admin'),
  ('Hawana Airways Admin', 'admin@hawanaairways.com', '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa', 'admin'),
  ('Finance User', 'finance@hams.aero', '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa', 'finance'),
  ('Operations User', 'ops@hams.aero', '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa', 'operations'),
  ('Booking Agent', 'agent@hams.aero', '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa', 'agent'),
  ('Crew Member', 'crew@hams.aero', '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa', 'crew'),
  ('Maintenance Engineer', 'mx@hams.aero', '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa', 'maintenance')
ON CONFLICT (email) DO NOTHING;

INSERT INTO aircraft (tail_number, model, seat_capacity, release_status)
VALUES
  ('5Y-HAW', 'Boeing 737-800', 162, 'RELEASED'),
  ('5Y-HAM', 'Airbus A320', 150, 'RELEASED')
ON CONFLICT (tail_number) DO NOTHING;

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
  NOW() + INTERVAL '1 day' + INTERVAL '3 hour',
  NOW() + INTERVAL '1 day' + INTERVAL '8 hour',
  'SCHEDULED',
  a.id,
  u.id
FROM aircraft a
JOIN users u ON u.email = 'admin@hams.aero'
WHERE a.tail_number = '5Y-HAW'
AND NOT EXISTS (
  SELECT 1 FROM flights f
  WHERE f.flight_number = 'HW101'
    AND DATE(f.departure_time) = DATE(NOW() + INTERVAL '1 day')
);

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
  NOW() + INTERVAL '2 day' + INTERVAL '4 hour',
  NOW() + INTERVAL '2 day' + INTERVAL '9 hour',
  'SCHEDULED',
  a.id,
  u.id
FROM aircraft a
JOIN users u ON u.email = 'admin@hams.aero'
WHERE a.tail_number = '5Y-HAM'
AND NOT EXISTS (
  SELECT 1 FROM flights f
  WHERE f.flight_number = 'HW205'
    AND DATE(f.departure_time) = DATE(NOW() + INTERVAL '2 day')
);
