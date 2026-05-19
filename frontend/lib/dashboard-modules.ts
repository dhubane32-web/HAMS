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

const OCC: ErpModuleTile = {
  id: 'occ',
  title: 'Operations Control Center',
  description: 'Live network control, delays, IROPS, rotations, and operational alerts.',
  href: '/occ'
};

const LIVE_FLIGHTS: ErpModuleTile = {
  id: 'live-flights',
  title: 'Live Flight Tracking',
  description: 'Movement board, phases, OTP, and fleet rotation chain.',
  href: '/live-flights'
};

const DISPATCH: ErpModuleTile = {
  id: 'dispatch',
  title: 'Flight Dispatch',
  description: 'Dispatch releases, fuel, loadsheets, and route release.',
  href: '/dispatch'
};

const CHECKIN: ErpModuleTile = {
  id: 'checkin',
  title: 'Check-in & Boarding',
  description: 'Passenger check-in, seats, boarding passes, manifest, and gate readiness.',
  href: '/checkin'
};

const FLIGHT_OPS: ErpModuleTile = {
  id: 'flight-ops',
  title: 'Flight Operations',
  description: 'Schedule, flight control, and day-of-ops board.',
  href: '/operations'
};

const MAINTENANCE: ErpModuleTile = {
  id: 'maintenance',
  title: 'Aircraft Maintenance',
  description: 'MEL/CDL, defects, AOG, inspections, and serviceability.',
  href: '/maintenance'
};

const CREW_CONTROL: ErpModuleTile = {
  id: 'crew-control',
  title: 'Crew Control',
  description: 'FDTL, legality, assignments, and crew disruptions.',
  href: '/crew-control'
};

const CREW: ErpModuleTile = {
  id: 'crew',
  title: 'Crew Management',
  description: 'Roster, qualifications, and HR crew records.',
  href: '/crew'
};

const REVENUE: ErpModuleTile = {
  id: 'revenue',
  title: 'Revenue Management',
  description: 'Fare buckets, load factor, route profitability, and yield.',
  href: '/revenue'
};

const FINANCE: ErpModuleTile = {
  id: 'finance',
  title: 'Finance & Accounting',
  description: 'Cash, AR/AP, refunds, ledger activity, and posted revenue.',
  href: '/finance'
};

const SALES: ErpModuleTile = {
  id: 'sales',
  title: 'Commercial & Revenue',
  description: 'Campaigns, channels, promo codes, and commercial workspace.',
  href: '/sales'
};

const PASSENGER_SERVICES: ErpModuleTile = {
  id: 'passenger-services',
  title: 'Passenger Services',
  description: 'Disruptions, complaints, SSR, VIP, and passenger history.',
  href: '/customers'
};

const SAFETY: ErpModuleTile = {
  id: 'safety',
  title: 'Safety & Compliance',
  description: 'SMS incidents, risk register, audits, and corrective actions.',
  href: '/safety'
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
  OCC,
  LIVE_FLIGHTS,
  DISPATCH,
  FLIGHT_OPS,
  CREW_CONTROL,
  MAINTENANCE,
  CREW,
  REVENUE,
  FINANCE,
  SALES,
  PASSENGER_SERVICES,
  SAFETY,
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
      return [has('dashboard'), has('finance'), has('revenue'), has('reports')];
    case 'operations':
      return [has('dashboard'), has('occ'), has('live-flights'), has('dispatch'), has('flight-ops'), has('reports')];
    case 'crew':
      return [has('dashboard'), has('crew'), has('crew-control')];
    case 'maintenance':
      return [has('dashboard'), has('maintenance'), has('safety')];
    case 'sales_manager':
      return [has('dashboard'), has('sales'), has('revenue'), has('reports')];
    case 'customer_service':
      return [has('dashboard'), has('passenger-services')];
    case 'agent':
      return [
        has('dashboard'),
        has('booking-ticketing'),
        has('checkin'),
        has('passenger-services'),
        has('sales')
      ];
    default:
      return [has('dashboard')];
  }
}
