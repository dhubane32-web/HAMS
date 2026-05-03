import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  BookCopy,
  PlaneTakeoff,
  SlidersHorizontal,
  Users,
  Wallet,
  Megaphone,
  Headset,
  BarChart3,
  Settings,
  ShieldCheck
} from 'lucide-react';
import type { UserRole } from '@/lib/roles';

export type NavItem = { href: string; label: string; icon: LucideIcon; roles: UserRole[] };

const ALL_APP: UserRole[] = [
  'super_admin',
  'admin',
  'finance',
  'operations',
  'agent',
  'crew',
  'maintenance',
  'customer_service',
  'sales_manager'
];

/**
 * Primary airline ERP sidebar — order matches operations dashboard tiles.
 * Paths align with `erpModuleTilesForRole` in `dashboard-modules.ts`.
 */
export const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: ALL_APP
  },
  {
    href: '/booking',
    label: 'Booking & Ticketing',
    icon: BookCopy,
    roles: ['super_admin', 'admin', 'finance', 'operations', 'agent', 'customer_service', 'sales_manager']
  },
  {
    href: '/checkin',
    label: 'Check-in & Boarding',
    icon: PlaneTakeoff,
    roles: ['super_admin', 'admin', 'operations', 'agent', 'customer_service', 'sales_manager']
  },
  {
    href: '/operations',
    label: 'Flight & Operations',
    icon: SlidersHorizontal,
    roles: ['super_admin', 'admin', 'operations', 'maintenance']
  },
  {
    href: '/crew',
    label: 'Crew Management',
    icon: Users,
    roles: ['super_admin', 'admin', 'operations']
  },
  {
    href: '/finance',
    label: 'Finance & Accounting',
    icon: Wallet,
    roles: ['super_admin', 'admin', 'finance', 'agent', 'sales_manager']
  },
  {
    href: '/sales',
    label: 'Sales & Marketing',
    icon: Megaphone,
    roles: ['super_admin', 'admin', 'agent', 'sales_manager']
  },
  {
    href: '/customers',
    label: 'Customer Service',
    icon: Headset,
    roles: ['super_admin', 'admin', 'operations', 'agent', 'customer_service', 'sales_manager']
  },
  {
    href: '/reports',
    label: 'Reports & Analytics',
    icon: BarChart3,
    roles: ['super_admin', 'admin', 'finance', 'operations', 'sales_manager', 'agent', 'customer_service', 'maintenance', 'crew']
  },
  {
    href: '/settings',
    label: 'Settings & Master Data',
    icon: Settings,
    roles: ['super_admin', 'admin']
  },
  {
    href: '/admin',
    label: 'System Administration',
    icon: ShieldCheck,
    roles: ['super_admin', 'admin']
  }
];

export function navForRole(role: UserRole | null): NavItem[] {
  if (!role) return navItems.filter((n) => n.href === '/dashboard');
  return navItems.filter((n) => {
    if (n.roles.includes(role)) return true;
    if (role === 'super_admin' && n.roles.includes('admin')) return true;
    return false;
  });
}

export function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === '/dashboard') return false;
  if (href === '/booking' && pathname.startsWith('/bookings')) return true;
  if (href === '/settings' && pathname.startsWith('/settings-master-data')) return true;
  return pathname.startsWith(`${href}/`);
}
