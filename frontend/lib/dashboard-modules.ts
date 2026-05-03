import type { UserRole } from '@/lib/roles';

/** One navigable ERP area — each `href` matches the primary sidebar in `nav-config.ts`. */
export type ErpModuleTile = {
  id: string;
  title: string;
  description: string;
  href: string;
};

const DASHBOARD: ErpModuleTile = {
  id: 'dashboard',
  title: 'Dashboard',
  description: 'Live KPIs, alerts, and quick access to every HAMS department.',
  href: '/dashboard'
};

const BOOKING_TICKETING: ErpModuleTile = {
  id: 'booking-ticketing',
  title: 'Booking & Ticketing',
  description: 'New reservations, PNRs, availability, pricing, and ticket issuance.',
  href: '/booking'
};

const CHECKIN: ErpModuleTile = {
  id: 'checkin',
  title: 'Check-in & Boarding',
  description: 'Passenger check-in, seats, boarding passes, manifest, and gate readiness.',
  href: '/checkin'
};

const FLIGHT_OPS: ErpModuleTile = {
  id: 'flight-ops',
  title: 'Flight & Operations',
  description: 'Dispatch, delays, aircraft assignment, and day-of-operations control.',
  href: '/operations'
};

const MAINTENANCE: ErpModuleTile = {
  id: 'maintenance',
  title: 'Maintenance & Aircraft',
  description: 'Defects, inspections, release to service, and technical history.',
  href: '/maintenance'
};

const CREW: ErpModuleTile = {
  id: 'crew',
  title: 'Crew Management',
  description: 'Roster, duty assignments, qualifications, and compliance.',
  href: '/crew'
};

const FINANCE: ErpModuleTile = {
  id: 'finance',
  title: 'Finance & Accounting',
  description: 'Cash, AR/AP, refunds, ledger activity, and posted revenue.',
  href: '/finance'
};

const SALES: ErpModuleTile = {
  id: 'sales',
  title: 'Sales & Marketing',
  description: 'Campaigns, channels, promo codes, and revenue levers.',
  href: '/sales'
};

const CUSTOMER_SERVICE: ErpModuleTile = {
  id: 'customer-service',
  title: 'Customer Service',
  description: 'Passenger CRM, service history, and commercial follow-up.',
  href: '/customers'
};

const REPORTS: ErpModuleTile = {
  id: 'reports',
  title: 'Reports & Analytics',
  description: 'Executive and operational reporting packs.',
  href: '/reports'
};

const SETTINGS_MASTER: ErpModuleTile = {
  id: 'settings-master',
  title: 'Settings & Master Data',
  description: 'Reference data: routes, airports, aircraft types, fares, taxes, and baggage rules.',
  href: '/settings'
};

const SYSTEM_ADMIN: ErpModuleTile = {
  id: 'system-admin',
  title: 'System Administration',
  description: 'HAMS accounts, roles, sign-in policy, and user administration.',
  href: '/admin'
};

const MAIN_MODULES: ErpModuleTile[] = [
  DASHBOARD,
  BOOKING_TICKETING,
  CHECKIN,
  FLIGHT_OPS,
  MAINTENANCE,
  CREW,
  FINANCE,
  SALES,
  CUSTOMER_SERVICE,
  REPORTS,
  SETTINGS_MASTER,
  SYSTEM_ADMIN
];

export function erpModuleTilesForRole(role: UserRole): ErpModuleTile[] {
  const has = (id: string) => MAIN_MODULES.find((m) => m.id === id)!;

  switch (role) {
    case 'super_admin':
    case 'admin':
      return MAIN_MODULES;
    case 'booking_agent':
      return [has('dashboard'), has('booking-ticketing')];
    case 'checkin_agent':
      return [has('dashboard'), has('checkin')];
    case 'finance':
      return [has('dashboard'), has('finance'), has('reports')];
    case 'operations':
      return [has('dashboard'), has('flight-ops'), has('reports')];
    case 'crew':
      return [has('dashboard'), has('crew')];
    case 'maintenance':
      return [has('dashboard'), has('maintenance')];
    case 'sales_manager':
      return [has('dashboard'), has('sales'), has('reports')];
    case 'customer_service':
      return [has('dashboard'), has('customer-service')];
    case 'agent':
      return [
        has('dashboard'),
        has('booking-ticketing'),
        has('checkin'),
        has('customer-service'),
        has('sales')
      ];
    default:
      return [has('dashboard')];
  }
}
