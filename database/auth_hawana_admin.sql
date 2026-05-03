-- Default Hawana Airways admin for HAMS login (idempotent).
-- Password: Admin123! (same bcrypt as database/seed.sql demo users)

INSERT INTO users (full_name, email, password_hash, role, is_active)
VALUES (
  'Hawana Airways Admin',
  'admin@hawanaairways.com',
  '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa',
  'admin'::user_role,
  TRUE
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  full_name = EXCLUDED.full_name,
  is_active = TRUE,
  role = 'admin'::user_role;
