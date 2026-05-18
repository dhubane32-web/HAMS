-- Default Hawana Airways admin for HAMS login (idempotent).
-- Password: Hawana@2026  |  Role: super_admin (JWT + app RBAC)
-- Or run: node backend/scripts/reset-hawana-admin-password.mjs
-- Requires user_role enum value super_admin (see database/system_administration.sql or DO block below).

DO $$ BEGIN ALTER TYPE user_role ADD VALUE 'super_admin';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO users (full_name, email, password_hash, role, is_active)
VALUES (
  'Hawana Airways Admin',
  'admin@hawanaairways.com',
  '$2b$10$JLTOuH74hKkdNs4zFBWGDu8pCgwA8grXjxSqCRltqjc.q5et.xzlu',
  'super_admin'::user_role,
  TRUE
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  full_name = EXCLUDED.full_name,
  is_active = TRUE,
  role = 'super_admin'::user_role;
