/**
 * Role checks for JWT `role` claim.
 * Super Admin inherits access wherever `admin` is allowed (platform operations).
 */
export function userHasAnyRole(userRole, allowedRoles) {
  if (!userRole || !Array.isArray(allowedRoles) || allowedRoles.length === 0) return false;
  if (allowedRoles.includes(userRole)) return true;
  if (userRole === 'super_admin' && allowedRoles.includes('admin')) return true;
  return false;
}

export function isSuperAdmin(role) {
  return role === 'super_admin';
}

export function canManageUsers(role) {
  return role === 'super_admin' || role === 'admin';
}
