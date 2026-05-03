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
  ShieldCheck,
  Wrench
} from 'lucide-react';
import type { UserRole } from '@/lib/roles';

export type NavItem = { href: string; label: string; icon: LucideIcon; roles: UserRole[] };

const ADMINS: UserRole[] = ['super_admin', 'admin'];
const BOOKING: UserRole[] = ['super_admin', 'admin', 'agent', 'booking_agent', 'customer_service', 'sales_manager'];
const CHECKIN: UserRole[] = ['super_admin', 'admin', 'agent', 'checkin_agent', 'operations'];
const OPS: UserRole[] = ['super_admin', 'admin', 'operations'];
const CREW: UserRole[] = ['super_admin', 'admin', 'operations', 'crew'];
const FINANCE: UserRole[] = ['super_admin', 'admin', 'finance'];
const SALES: UserRole[] = ['super_admin', 'admin', 'sales_manager'];
const CUSTOMERS: UserRole[] = ['super_admin', 'admin', 'customer_service'];
const REPORTS: UserRole[] = ['super_admin', 'admin', 'finance', 'operations', 'sales_manager', 'agent'];
const SETTINGS: UserRole[] = ['super_admin', 'admin'];
const MAINT: UserRole[] = ['super_admin', 'admin', 'maintenance'];

/**
 * Primary airline ERP sidebar — order matches operations dashboard tiles.
 * Paths align with `erpModuleTilesForRole` in `dashboard-modules.ts`.
 */
export const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: [
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
    ]
  },
  {
    href: '/booking',
    label: 'Booking & Ticketing',
    icon: BookCopy,
    roles: BOOKING
  },
  {
    href: '/checkin',
    label: 'Check-in & Boarding',
    icon: PlaneTakeoff,
    roles: CHECKIN
  },
  {
    href: '/operations',
    label: 'Flight & Operations',
    icon: SlidersHorizontal,
    roles: OPS
  },
  {
    href: '/maintenance',
    label: 'Maintenance & Aircraft',
    icon: Wrench,
    roles: MAINT
  },
  {
    href: '/crew',
    label: 'Crew Management',
    icon: Users,
    roles: CREW
  },
  {
    href: '/finance',
    label: 'Finance & Accounting',
    icon: Wallet,
    roles: FINANCE
  },
  {
    href: '/sales',
    label: 'Sales & Marketing',
    icon: Megaphone,
    roles: SALES
  },
  {
    href: '/customers',
    label: 'Customer Service',
    icon: Headset,
    roles: CUSTOMERS
  },
  {
    href: '/reports',
    label: 'Reports & Analytics',
    icon: BarChart3,
    roles: REPORTS
  },
  {
    href: '/settings',
    label: 'Settings & Master Data',
    icon: Settings,
    roles: SETTINGS
  },
  {
    href: '/admin',
    label: 'System Administration',
    icon: ShieldCheck,
    roles: ADMINS
  }
];

export function navForRole(role: UserRole | null): NavItem[] {
  if (!role) return navItems.filter((n) => n.href === '/dashboard');
  if (role === 'super_admin') return navItems;
  return navItems.filter((n) => n.roles.includes(role));
}

export function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === '/dashboard') return false;
  if (href === '/booking' && pathname.startsWith('/bookings')) return true;
  if (href === '/settings' && pathname.startsWith('/settings-master-data')) return true;
  if (href === '/maintenance' && pathname.startsWith('/maintenance')) return true;
  return pathname.startsWith(`${href}/`);
}
