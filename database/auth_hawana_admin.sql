-- Default Hawana Airways admin for HAMS login (idempotent).
-- Password: Admin12345!  |  Role: super_admin (JWT + app RBAC)
-- Requires user_role enum value super_admin (see database/system_administration.sql or DO block below).

DO $$ BEGIN ALTER TYPE user_role ADD VALUE 'super_admin';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO users (full_name, email, password_hash, role, is_active)
VALUES (
  'Hawana Airways Admin',
  'admin@hawanaairways.com',
  '$2b$10$xavnCa/8O0uMAf/BLVNCp.EQOVejcBPWD31LoFSyqEikMF.Vk.exy',
  'super_admin'::user_role,
  TRUE
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  full_name = EXCLUDED.full_name,
  is_active = TRUE,
  role = 'super_admin'::user_role;
