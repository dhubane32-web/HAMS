'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import type { UserRole } from '@/lib/roles';
import { roleDisplayName } from '@/lib/roles';
import { rbacBadgeClass, rbacBadgeLabel } from '@/lib/airline-rbac';
import { getPublicApiBaseUrl } from '@/lib/api-base';

const API_BASE_URL = getPublicApiBaseUrl();

const ALL_ROLES: UserRole[] = [
  'super_admin',
  'admin',
  'finance',
  'operations',
  'agent',
  'booking_agent',
  'checkin_agent',
  'crew',
  'maintenance',
  'customer_service',
  'sales_manager'
];

type Capabilities = {
  role: UserRole;
  isSuperAdmin: boolean;
  canManageUsers: boolean;
  canManageRoles: boolean;
  canEditSecuritySettings: boolean;
  canEditBackupSettings: boolean;
  canEditNotificationSettings: boolean;
};

type UserRow = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
};

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
}

async function api(path: string, init?: RequestInit) {
  const token = getToken();
  return fetch(`${API_BASE_URL}/api/system${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });
}

type Tab = 'users' | 'roles' | 'audit' | 'logins' | 'activity' | 'security' | 'backup' | 'notifications';

export default function SystemAdministrationApp() {
  const [tab, setTab] = useState<Tab>('users');
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [auditRows, setAuditRows] = useState<Record<string, unknown>[]>([]);
  const [loginRows, setLoginRows] = useState<Record<string, unknown>[]>([]);
  const [activityRows, setActivityRows] = useState<Record<string, unknown>[]>([]);
  const [rolesEnum, setRolesEnum] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<{ code: string; description: string; category: string }[]>([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [rolePermCodes, setRolePermCodes] = useState<string[]>([]);
  const [securityJson, setSecurityJson] = useState('{}');
  const [backupJson, setBackupJson] = useState('{}');
  const [notifJson, setNotifJson] = useState('{}');

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('agent');
  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  const loadCaps = useCallback(async () => {
    const r = await api('/capabilities');
    const j = (await r.json()) as Capabilities & { message?: string };
    if (!r.ok) {
      toast.error(j.message || 'Unable to load capabilities.');
      return;
    }
    setCaps(j);
  }, []);

  const loadUsers = useCallback(async () => {
    const r = await api('/users');
    const j = (await r.json()) as { users?: UserRow[]; message?: string };
    if (!r.ok) return toast.error(j.message || 'Failed to load users');
    setUsers(j.users || []);
  }, []);

  const loadAudit = useCallback(async () => {
    const r = await api('/audit-logs?limit=150');
    const j = (await r.json()) as { rows?: Record<string, unknown>[]; message?: string };
    if (!r.ok) return toast.error(j.message || 'Failed');
    setAuditRows(j.rows || []);
  }, []);

  const loadLogins = useCallback(async () => {
    const r = await api('/login-history?limit=150');
    const j = (await r.json()) as { rows?: Record<string, unknown>[]; message?: string };
    if (!r.ok) return toast.error(j.message || 'Failed');
    setLoginRows(j.rows || []);
  }, []);

  const loadActivity = useCallback(async () => {
    const r = await api('/activity?limit=120');
    const j = (await r.json()) as { rows?: Record<string, unknown>[]; message?: string };
    if (!r.ok) return toast.error(j.message || 'Failed');
    setActivityRows(j.rows || []);
  }, []);

  const loadRolesMeta = useCallback(async () => {
    if (!caps?.isSuperAdmin) return;
    const [r1, r2] = await Promise.all([api('/roles'), api('/permissions')]);
    const j1 = (await r1.json()) as { roles?: string[] };
    const j2 = (await r2.json()) as { permissions?: { code: string; description: string; category: string }[] };
    if (r1.ok) setRolesEnum(j1.roles || []);
    if (r2.ok) setPermissions(j2.permissions || []);
  }, [caps?.isSuperAdmin]);

  const loadRolePerms = useCallback(async () => {
    if (!caps?.isSuperAdmin || !selectedRole) return;
    const r = await api(`/roles/${encodeURIComponent(selectedRole)}/permissions`);
    const j = (await r.json()) as { permissionCodes?: string[]; message?: string };
    if (!r.ok) return toast.error(j.message || 'Failed');
    setRolePermCodes(j.permissionCodes || []);
  }, [caps?.isSuperAdmin, selectedRole]);

  const loadSettings = useCallback(async () => {
    if (!caps) return;
    const fetchCat = async (cat: string, can: boolean) => {
      if (!can) return;
      const r = await api(`/settings/${cat}`);
      const j = (await r.json()) as { settings?: { setting_key: string; value_json: unknown }[] };
      if (!r.ok) return;
      const merged: Record<string, unknown> = {};
      for (const row of j.settings || []) {
        merged[row.setting_key] = row.value_json;
      }
      const s = JSON.stringify(merged, null, 2);
      if (cat === 'security') setSecurityJson(s);
      if (cat === 'backup') setBackupJson(s);
      if (cat === 'notification') setNotifJson(s);
    };
    await fetchCat('security', Boolean(caps?.canEditSecuritySettings));
    await fetchCat('backup', Boolean(caps?.canEditBackupSettings));
    await fetchCat('notification', Boolean(caps?.canEditNotificationSettings));
  }, [caps]);

  useEffect(() => {
    void loadCaps();
  }, [loadCaps]);

  useEffect(() => {
    if (!caps) return;
    if (tab === 'users') void loadUsers();
    if (tab === 'audit') void loadAudit();
    if (tab === 'logins') void loadLogins();
    if (tab === 'activity') void loadActivity();
    if (tab === 'roles') void loadRolesMeta();
    if (tab === 'security' || tab === 'backup' || tab === 'notifications') void loadSettings();
  }, [tab, caps, loadUsers, loadAudit, loadLogins, loadActivity, loadRolesMeta, loadSettings]);

  useEffect(() => {
    if (tab === 'roles' && selectedRole) void loadRolePerms();
  }, [tab, selectedRole, loadRolePerms]);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    const r = await api('/users', {
      method: 'POST',
      body: JSON.stringify({ full_name: newName, email: newEmail, password: newPassword, role: newRole })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Create failed');
    toast.success('User created');
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    void loadUsers();
  }

  async function updateUser(u: UserRow, patch: Partial<{ full_name: string; role: UserRole; is_active: boolean }>) {
    const r = await api(`/users/${u.id}`, { method: 'PUT', body: JSON.stringify(patch) });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Update failed');
    toast.success('Saved');
    void loadUsers();
  }

  async function submitPasswordReset(e: FormEvent) {
    e.preventDefault();
    if (!resetUserId || resetPassword.length < 8) {
      toast.error('Choose user and use password ≥ 8 characters.');
      return;
    }
    const r = await api(`/users/${resetUserId}/password-reset`, {
      method: 'POST',
      body: JSON.stringify({ newPassword: resetPassword })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Password updated');
    setResetPassword('');
    setResetUserId('');
  }

  async function saveRolePermissions(e: FormEvent) {
    e.preventDefault();
    if (!selectedRole) return;
    const r = await api(`/roles/${encodeURIComponent(selectedRole)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissionCodes: rolePermCodes })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Save failed');
    toast.success('Role permissions saved');
  }

  async function saveSetting(category: string, jsonText: string) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      return toast.error('Invalid JSON');
    }
    for (const [setting_key, value] of Object.entries(parsed)) {
      const r = await api(`/settings/${category}/${encodeURIComponent(setting_key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value })
      });
      const j = await r.json();
      if (!r.ok) return toast.error(j.message || 'Save failed');
    }
    toast.success('Settings saved');
  }

  const assignableRoles = caps?.isSuperAdmin
    ? ALL_ROLES
    : ALL_ROLES.filter((r) => r !== 'super_admin');

  return (
    <div className="module-page" style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(
          [
            ['users', 'Users', (c: Capabilities) => c.canManageUsers],
            ['roles', 'Roles & permissions', (c: Capabilities) => c.canManageRoles],
            ['audit', 'Audit logs', (c: Capabilities) => c.canManageUsers],
            ['logins', 'Login history', (c: Capabilities) => c.canManageUsers],
            ['activity', 'Activity stream', (c: Capabilities) => c.canManageUsers],
            ['security', 'Security', (c: Capabilities) => c.canEditSecuritySettings],
            ['backup', 'Backup', (c: Capabilities) => c.canEditBackupSettings],
            ['notifications', 'Notifications', (c: Capabilities) => c.canEditNotificationSettings]
          ] as const
        ).map(([id, label, visible]) => {
          if (!caps || !visible(caps)) return null;
          return (
            <button
              key={id}
              type="button"
              className={tab === id ? undefined : 'secondary'}
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.55rem' }}
              onClick={() => setTab(id as Tab)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {!caps && <p className="module-card">Loading access…</p>}

      {caps && tab === 'users' && caps.canManageUsers && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>User management</h2>
          <p style={{ color: '#64748b', fontSize: '0.88rem', marginTop: 0 }}>
            Create accounts, assign roles, activate or deactivate users, and set passwords (bcrypt on the server).
          </p>
          <form className="module-form-grid" onSubmit={createUser}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" required />
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" placeholder="Email" required />
            <input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              type="password"
              placeholder="Initial password"
              minLength={8}
              required
            />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {roleDisplayName(r)}
                </option>
              ))}
            </select>
            <button type="submit">Create user</button>
          </form>

          <h3 style={{ marginTop: '1.25rem' }}>Directory</h3>
          <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <table className="module-table" style={{ fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role &amp; access</th>
                  <th>Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.full_name}</td>
                    <td>{u.email}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <span className={rbacBadgeClass(u.role)} title="RBAC scope">
                          {rbacBadgeLabel(u.role)}
                        </span>
                        {!caps.isSuperAdmin && u.role === 'super_admin' ? (
                          <span>{roleDisplayName(u.role)}</span>
                        ) : (
                          <select
                            value={u.role}
                            onChange={(e) => void updateUser(u, { role: e.target.value as UserRole })}
                          >
                            {(caps.isSuperAdmin ? ALL_ROLES : assignableRoles).map((r) => (
                              <option key={r} value={r}>
                                {roleDisplayName(r)}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                    <td>{u.is_active ? 'Yes' : 'No'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!caps.isSuperAdmin && u.role === 'super_admin'}
                        onClick={() => void updateUser(u, { is_active: !u.is_active })}
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: '1rem' }}>Password reset (admin)</h3>
          <form className="module-form-grid" onSubmit={submitPasswordReset}>
            <select value={resetUserId} onChange={(e) => setResetUserId(e.target.value)} required>
              <option value="">Select user</option>
              {users
                .filter((u) => caps?.isSuperAdmin || u.role !== 'super_admin')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
            </select>
            <input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="New password"
              minLength={8}
            />
            <button type="submit">Set password</button>
          </form>
        </section>
      )}

      {caps && tab === 'roles' && caps.canManageRoles && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Role &amp; permission matrix</h2>
          <p style={{ color: '#64748b', fontSize: '0.88rem' }}>
            Super Admin only. Changes apply to API authorization keys stored in <code>sys_role_permissions</code>.
          </p>
          <div className="module-form-grid" style={{ alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Role</span>
              <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}>
                <option value="">Select…</option>
                {(rolesEnum.length ? rolesEnum : ALL_ROLES).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedRole && (
            <form onSubmit={saveRolePermissions} style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'grid', gap: 6, maxHeight: 280, overflow: 'auto', padding: '0.5rem 0' }}>
                {permissions.map((p) => (
                  <label key={p.code} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={rolePermCodes.includes(p.code)}
                      onChange={(e) => {
                        if (e.target.checked) setRolePermCodes((c) => [...c, p.code]);
                        else setRolePermCodes((c) => c.filter((x) => x !== p.code));
                      }}
                    />
                    <span>
                      <strong>{p.code}</strong> — {p.description}{' '}
                      <span style={{ color: '#94a3b8' }}>({p.category})</span>
                    </span>
                  </label>
                ))}
              </div>
              <button type="submit" style={{ marginTop: '0.5rem' }}>
                Save permissions for {selectedRole}
              </button>
            </form>
          )}
        </section>
      )}

      {caps && tab === 'audit' && caps.canManageUsers && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Audit logs</h2>
          <button type="button" className="secondary" onClick={() => void loadAudit()}>
            Refresh
          </button>
          <pre style={{ fontSize: '0.72rem', maxHeight: 400, overflow: 'auto', background: '#f8fafc', padding: '0.75rem' }}>
            {JSON.stringify(auditRows, null, 2)}
          </pre>
        </section>
      )}

      {caps && tab === 'logins' && caps.canManageUsers && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Login history</h2>
          <button type="button" className="secondary" onClick={() => void loadLogins()}>
            Refresh
          </button>
          <pre style={{ fontSize: '0.72rem', maxHeight: 400, overflow: 'auto', background: '#f8fafc', padding: '0.75rem' }}>
            {JSON.stringify(loginRows, null, 2)}
          </pre>
        </section>
      )}

      {caps && tab === 'activity' && caps.canManageUsers && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>System activity</h2>
          <p style={{ color: '#64748b', fontSize: '0.88rem' }}>Merged audit and login events (most recent first).</p>
          <button type="button" className="secondary" onClick={() => void loadActivity()}>
            Refresh
          </button>
          <pre style={{ fontSize: '0.72rem', maxHeight: 400, overflow: 'auto', background: '#f8fafc', padding: '0.75rem' }}>
            {JSON.stringify(activityRows, null, 2)}
          </pre>
        </section>
      )}

      {caps && tab === 'security' && caps.canEditSecuritySettings && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Security settings</h2>
          <p style={{ color: '#64748b', fontSize: '0.88rem' }}>JSON object keyed by setting name (see seed keys: session, password_policy).</p>
          <textarea
            value={securityJson}
            onChange={(e) => setSecurityJson(e.target.value)}
            rows={12}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
          <button type="button" onClick={() => void saveSetting('security', securityJson)}>
            Save security
          </button>
        </section>
      )}

      {caps && tab === 'backup' && caps.canEditBackupSettings && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Backup settings</h2>
          <textarea
            value={backupJson}
            onChange={(e) => setBackupJson(e.target.value)}
            rows={10}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
          <button type="button" onClick={() => void saveSetting('backup', backupJson)}>
            Save backup
          </button>
        </section>
      )}

      {caps && tab === 'notifications' && caps.canEditNotificationSettings && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Notification settings</h2>
          <textarea
            value={notifJson}
            onChange={(e) => setNotifJson(e.target.value)}
            rows={10}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
          <button type="button" onClick={() => void saveSetting('notification', notifJson)}>
            Save notifications
          </button>
        </section>
      )}
    </div>
  );
}
