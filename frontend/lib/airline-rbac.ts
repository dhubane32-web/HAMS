import type { UserRole } from '@/lib/roles';

/** Coarse app areas aligned with sidebar + manual URL guard. */
export type AppModule =
  | 'unknown'
  | 'dashboard'
  | 'booking'
  | 'checkin'
  | 'commercial'
  | 'occ'
  | 'dispatch'
  | 'live-flights'
  | 'operations'
  | 'crew-control'
  | 'crew'
  | 'maintenance'
  | 'revenue'
  | 'safety'
  | 'finance'
  | 'sales'
  | 'customers'
  | 'reports'
  | 'settings'
  | 'admin'
  | 'notifications'
  | 'workspace'
  | 'system-settings';

export function pathnameToModule(pathname: string): AppModule {
  if (!pathname || pathname === '/') return 'dashboard';
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/bookings') || pathname.startsWith('/booking')) return 'booking';
  if (pathname.startsWith('/commercial')) return 'commercial';
  if (pathname.startsWith('/checkin')) return 'checkin';
  if (pathname.startsWith('/occ')) return 'occ';
  if (pathname.startsWith('/dispatch')) return 'dispatch';
  if (pathname.startsWith('/live-flights')) return 'live-flights';
  if (pathname.startsWith('/operations') || pathname.startsWith('/flights')) return 'operations';
  if (pathname.startsWith('/crew-control')) return 'crew-control';
  if (pathname.startsWith('/crew-management') || pathname.startsWith('/crew')) return 'crew';
  if (pathname.startsWith('/maintenance')) return 'maintenance';
  if (pathname.startsWith('/revenue')) return 'revenue';
  if (pathname.startsWith('/safety')) return 'safety';
  if (pathname.startsWith('/finance') || pathname.startsWith('/add-expense')) return 'finance';
  if (pathname.startsWith('/sales') || pathname.startsWith('/sales-marketing')) return 'sales';
  if (pathname.startsWith('/customer-service') || pathname.startsWith('/customers')) return 'customers';
  if (pathname.startsWith('/reports-analytics') || pathname.startsWith('/reports')) return 'reports';
  if (pathname.startsWith('/settings-master-data') || pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/system-administration') || pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/notifications')) return 'notifications';
  if (pathname.startsWith('/workspace-settings')) return 'workspace';
  if (pathname.startsWith('/system-settings')) return 'system-settings';
  return 'unknown';
}

const ALL_MODULES: AppModule[] = [
  'dashboard',
  'booking',
  'commercial',
  'checkin',
  'occ',
  'dispatch',
  'live-flights',
  'operations',
  'crew-control',
  'crew',
  'maintenance',
  'revenue',
  'safety',
  'finance',
  'sales',
  'customers',
  'reports',
  'settings',
  'admin',
  'notifications',
  'workspace',
  'system-settings'
];

const OPS_MODULES: AppModule[] = [
  'dashboard',
  'occ',
  'dispatch',
  'live-flights',
  'operations',
  'crew-control',
  'reports',
  'notifications',
  'workspace'
];

/** Modules a role may open (Super Admin uses full list via admin branch). */
export function allowedModulesForRole(role: UserRole | null): AppModule[] {
  if (!role) return ['dashboard'];
  switch (role) {
    case 'super_admin':
    case 'admin':
      return ALL_MODULES;
    case 'booking_agent':
      return ['dashboard', 'booking', 'commercial', 'notifications', 'workspace'];
    case 'checkin_agent':
      return ['dashboard', 'checkin', 'notifications', 'workspace'];
    case 'finance':
      return ['dashboard', 'finance', 'revenue', 'reports', 'notifications', 'workspace'];
    case 'operations':
      return OPS_MODULES;
    case 'crew':
      return ['dashboard', 'crew', 'crew-control', 'notifications', 'workspace'];
    case 'maintenance':
      return ['dashboard', 'maintenance', 'safety', 'notifications', 'workspace'];
    case 'sales_manager':
      return ['dashboard', 'sales', 'revenue', 'reports', 'notifications', 'workspace'];
    case 'customer_service':
      return ['dashboard', 'customers', 'notifications', 'workspace'];
    case 'agent':
      return [
        'dashboard',
        'booking',
        'commercial',
        'checkin',
        'customers',
        'sales',
        'notifications',
        'workspace'
      ];
    default:
      return ['dashboard'];
  }
}

export function canAccessModule(role: UserRole | null, mod: AppModule): boolean {
  if (!role) return false;
  if (mod === 'unknown') return true;
  const allowed = allowedModulesForRole(role);
  return allowed.includes(mod);
}

/** Short label for user table badges (IATA-style ops clarity). */
export function rbacBadgeLabel(role: UserRole): string {
  switch (role) {
    case 'super_admin':
      return 'L1 SYS';
    case 'admin':
      return 'L2 OPS ADM';
    case 'booking_agent':
      return 'RSV / TKT';
    case 'checkin_agent':
      return 'DCS / GATE';
    case 'finance':
      return 'FIN CTRL';
    case 'operations':
      return 'OCC';
    case 'crew':
      return 'CRM CREW';
    case 'maintenance':
      return 'MOC';
    case 'sales_manager':
      return 'COMM';
    case 'customer_service':
      return 'PSS CS';
    case 'agent':
      return 'MULTI DESK';
    default:
      return String(role).toUpperCase().slice(0, 12);
  }
}

export function rbacBadgeClass(role: UserRole): string {
  switch (role) {
    case 'super_admin':
      return 'hams-rbac-badge hams-rbac-badge--critical';
    case 'admin':
      return 'hams-rbac-badge hams-rbac-badge--admin';
    case 'booking_agent':
    case 'checkin_agent':
      return 'hams-rbac-badge hams-rbac-badge--desk';
    case 'finance':
      return 'hams-rbac-badge hams-rbac-badge--finance';
    case 'operations':
      return 'hams-rbac-badge hams-rbac-badge--ops';
    case 'crew':
    case 'maintenance':
      return 'hams-rbac-badge hams-rbac-badge--tech';
    case 'sales_manager':
    case 'customer_service':
      return 'hams-rbac-badge hams-rbac-badge--commercial';
    case 'agent':
      return 'hams-rbac-badge hams-rbac-badge--legacy';
    default:
      return 'hams-rbac-badge';
  }
}
