-- Sample crew data for HAMS Crew Management (idempotent). Run after crew_management.sql.
-- Password hash matches seed.sql: Admin123!

INSERT INTO users (full_name, email, password_hash, role, is_active)
SELECT 'Demo Crew Pilot', 'demo-crew@hams.aero', '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa', 'crew'::user_role, TRUE
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'crew'::user_role);

INSERT INTO crew_profiles (user_id, crew_category, employee_number, base_airport, hire_date, notes)
SELECT
  u.id,
  CASE WHEN u.email = 'crew@hams.aero' THEN 'PILOT' ELSE 'CABIN' END,
  'EMP-' || SUBSTRING(REPLACE(u.id::text, '-', ''), 1, 8),
  'NBO',
  CURRENT_DATE,
  'Auto-seeded profile for crew management demo.'
FROM users u
WHERE u.role = 'crew'::user_role
  AND NOT EXISTS (SELECT 1 FROM crew_profiles p WHERE p.user_id = u.id);

INSERT INTO crew_assignments (flight_id, crew_user_id, duty_role)
SELECT f.id, u.id, 'Captain'
FROM users u
JOIN flights f ON f.flight_number = 'HW101'
WHERE u.email = 'crew@hams.aero' AND u.role = 'crew'::user_role
  AND NOT EXISTS (SELECT 1 FROM crew_assignments ca WHERE ca.flight_id = f.id AND ca.crew_user_id = u.id);

INSERT INTO crew_assignments (flight_id, crew_user_id, duty_role)
SELECT f.id, u.id, 'FO'
FROM users u
JOIN flights f ON f.flight_number = 'HW205'
WHERE u.email = 'crew@hams.aero' AND u.role = 'crew'::user_role
  AND NOT EXISTS (SELECT 1 FROM crew_assignments ca WHERE ca.flight_id = f.id AND ca.crew_user_id = u.id);

INSERT INTO crew_assignments (flight_id, crew_user_id, duty_role)
SELECT f.id, u.id, 'CA'
FROM users u
JOIN flights f ON f.flight_number = 'HW101'
WHERE u.email = 'demo-crew@hams.aero' AND u.role = 'crew'::user_role
  AND NOT EXISTS (SELECT 1 FROM crew_assignments ca WHERE ca.flight_id = f.id AND ca.crew_user_id = u.id);

INSERT INTO crew_assignments (flight_id, crew_user_id, duty_role)
SELECT f.id, u.id, 'CA'
FROM users u
JOIN flights f ON f.flight_number = 'HW205'
WHERE u.email = 'demo-crew@hams.aero' AND u.role = 'crew'::user_role
  AND NOT EXISTS (SELECT 1 FROM crew_assignments ca WHERE ca.flight_id = f.id AND ca.crew_user_id = u.id);

INSERT INTO crew_licenses (user_id, license_type, license_number, issuing_authority, issue_date, expiry_date, is_active)
SELECT u.id, 'ATPL', 'ATP-DEMO-1', 'KCAA', CURRENT_DATE - INTERVAL '400 days', CURRENT_DATE + INTERVAL '25 days', TRUE
FROM users u
WHERE u.role = 'crew'::user_role
  AND NOT EXISTS (
    SELECT 1 FROM crew_licenses l
    WHERE l.user_id = u.id AND l.license_type = 'ATPL' AND l.is_active = TRUE
  )
LIMIT 1;

INSERT INTO crew_medicals (user_id, medical_class, expiry_date, examiner_name, is_active)
SELECT u.id, 'Class 1', CURRENT_DATE + INTERVAL '12 days', 'Aviation Medical Center', TRUE
FROM users u
WHERE u.role = 'crew'::user_role
  AND NOT EXISTS (SELECT 1 FROM crew_medicals m WHERE m.user_id = u.id AND m.is_active = TRUE)
LIMIT 1;

INSERT INTO crew_training (user_id, training_code, title, completed_date, expiry_date, instructor)
SELECT u.id, 'CABIN_SAFETY', 'Cabin safety recurrent', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '300 days', 'Training Dept'
FROM users u
WHERE u.role = 'crew'::user_role
  AND NOT EXISTS (SELECT 1 FROM crew_training t WHERE t.user_id = u.id AND t.training_code = 'CABIN_SAFETY')
LIMIT 1;

UPDATE crew_profiles cp
SET crew_category = 'PILOT', updated_at = NOW()
FROM users u
WHERE cp.user_id = u.id AND u.email = 'crew@hams.aero' AND cp.crew_category IS DISTINCT FROM 'PILOT';
