import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  BookCopy,
  PlaneTakeoff,
  SlidersHorizontal,
  Users,
  Wallet,
  Megaphone,
  Briefcase,
  Headset,
  BarChart3,
  Settings,
  ShieldCheck,
  Wrench,
  Radar,
  Radio,
  Activity,
  UserCog,
  TrendingUp,
  ShieldAlert
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
const REVENUE: UserRole[] = ['super_admin', 'admin', 'sales_manager', 'finance'];
const SAFETY: UserRole[] = ['super_admin', 'admin', 'operations', 'maintenance'];

/**
 * Primary airline ERP sidebar — enterprise ops modules first for operations roles.
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
    href: '/commercial',
    label: 'Commercial Core',
    icon: Briefcase,
    roles: BOOKING
  },
  {
    href: '/checkin',
    label: 'Check-in & Boarding',
    icon: PlaneTakeoff,
    roles: CHECKIN
  },
  {
    href: '/occ',
    label: 'Operations Control Center',
    icon: Radar,
    roles: OPS
  },
  {
    href: '/live-flights',
    label: 'Live Flight Tracking',
    icon: Activity,
    roles: OPS
  },
  {
    href: '/dispatch',
    label: 'Flight Dispatch',
    icon: Radio,
    roles: OPS
  },
  {
    href: '/operations',
    label: 'Flight Operations',
    icon: SlidersHorizontal,
    roles: OPS
  },
  {
    href: '/crew-control',
    label: 'Crew Control',
    icon: UserCog,
    roles: [...OPS, 'crew']
  },
  {
    href: '/maintenance',
    label: 'Aircraft Maintenance',
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
    href: '/revenue',
    label: 'Revenue Management',
    icon: TrendingUp,
    roles: REVENUE
  },
  {
    href: '/finance',
    label: 'Finance & Accounting',
    icon: Wallet,
    roles: FINANCE
  },
  {
    href: '/sales',
    label: 'Commercial & Revenue',
    icon: Megaphone,
    roles: SALES
  },
  {
    href: '/customers',
    label: 'Passenger Services',
    icon: Headset,
    roles: CUSTOMERS
  },
  {
    href: '/safety',
    label: 'Safety & Compliance',
    icon: ShieldAlert,
    roles: SAFETY
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
  if (href === '/customers' && pathname.startsWith('/customer-service')) return true;
  if (href === '/occ' && pathname.startsWith('/occ')) return true;
  return pathname.startsWith(`${href}/`);
}
