-- Seed permissions and default role matrix. Run after system_administration.sql.

INSERT INTO sys_permissions (code, description, category) VALUES
  ('users.read', 'View users', 'users'),
  ('users.write', 'Create and update users', 'users'),
  ('users.password_reset', 'Force password reset', 'users'),
  ('users.activate', 'Activate or deactivate accounts', 'users'),
  ('roles.read', 'View roles and permission matrix', 'roles'),
  ('roles.write', 'Change role permissions', 'roles'),
  ('audit.read', 'View audit logs', 'security'),
  ('login_history.read', 'View login history', 'security'),
  ('settings.security', 'Edit security settings', 'settings'),
  ('settings.backup', 'Edit backup settings', 'settings'),
  ('settings.notification', 'Edit notification settings', 'settings')
ON CONFLICT (code) DO NOTHING;

-- Default grants: super_admin gets all (handled in app); explicit rows for other roles
INSERT INTO sys_role_permissions (role, permission_code)
SELECT r.role::user_role, r.code
FROM (VALUES
  ('admin', 'users.read'),
  ('admin', 'users.write'),
  ('admin', 'users.password_reset'),
  ('admin', 'users.activate'),
  ('admin', 'audit.read'),
  ('admin', 'login_history.read'),
  ('admin', 'settings.backup'),
  ('admin', 'settings.notification'),
  ('super_admin', 'users.read'),
  ('super_admin', 'users.write'),
  ('super_admin', 'users.password_reset'),
  ('super_admin', 'users.activate'),
  ('super_admin', 'roles.read'),
  ('super_admin', 'roles.write'),
  ('super_admin', 'audit.read'),
  ('super_admin', 'login_history.read'),
  ('super_admin', 'settings.security'),
  ('super_admin', 'settings.backup'),
  ('super_admin', 'settings.notification')
) AS r(role, code)
ON CONFLICT (role, permission_code) DO NOTHING;

INSERT INTO system_settings (category, setting_key, value_json) VALUES
  ('security', 'session', '{"maxConcurrentSessions": 3, "lockoutAttempts": 5}'::jsonb),
  ('security', 'password_policy', '{"minLength": 8, "requireUppercase": true}'::jsonb),
  ('backup', 'schedule', '{"enabled": false, "cron": "0 2 * * *", "retentionDays": 14}'::jsonb),
  ('notification', 'email', '{"enabled": false, "fromAddress": "noreply@hawana.aero"}'::jsonb)
ON CONFLICT (category, setting_key) DO NOTHING;

-- Promote primary admin to Super Admin (optional — comment out if undesired)
UPDATE users SET role = 'super_admin'::user_role WHERE email = 'admin@hams.aero';

INSERT INTO users (full_name, email, password_hash, role, is_active)
VALUES
  ('Customer Service Lead', 'cs@hams.aero', '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa', 'customer_service', TRUE),
  ('Sales Manager', 'sales@hams.aero', '$2b$10$Ywsju9fQ.U3gR1nxmIB8YuukMe92w3Ojmx.sqEV2uE4JEk1oH9tWa', 'sales_manager', TRUE)
ON CONFLICT (email) DO NOTHING;
