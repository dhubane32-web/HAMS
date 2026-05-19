/**
 * Enterprise airline module registry — titles, routes, API roots (incremental).
 * Existing workflows stay on legacy paths; new modules wrap or deep-link them.
 */

export type EnterpriseModuleId =
  | 'occ'
  | 'dispatch'
  | 'crew-control'
  | 'revenue'
  | 'safety'
  | 'live-flights'
  | 'operations'
  | 'maintenance'
  | 'commercial'
  | 'passenger-services';

export type EnterpriseModuleMeta = {
  id: EnterpriseModuleId;
  title: string;
  subtitle: string;
  href: string;
  apiPrefix?: string;
  legacyHref?: string;
};

export const ENTERPRISE_MODULES: Record<EnterpriseModuleId, EnterpriseModuleMeta> = {
  occ: {
    id: 'occ',
    title: 'Operations Control Center',
    subtitle: 'Live network control, delays, rotations, IROPS, and operational alerts.',
    href: '/occ',
    apiPrefix: '/api/operations/occ',
    legacyHref: '/operations?tab=occ'
  },
  dispatch: {
    id: 'dispatch',
    title: 'Flight Dispatch',
    subtitle: 'Dispatch releases, fuel, loadsheets, OFP preparation, and route release.',
    href: '/dispatch',
    apiPrefix: '/api/operations/enterprise',
    legacyHref: '/operations?tab=enterprise'
  },
  'crew-control': {
    id: 'crew-control',
    title: 'Crew Control',
    subtitle: 'FDTL, legality, assignments, standby, and disruption management.',
    href: '/crew-control',
    apiPrefix: '/api/crew',
    legacyHref: '/crew'
  },
  revenue: {
    id: 'revenue',
    title: 'Revenue Management',
    subtitle: 'Fare buckets, load factor, route profitability, and channel performance.',
    href: '/revenue',
    apiPrefix: '/api/sales/commercial',
    legacyHref: '/sales'
  },
  safety: {
    id: 'safety',
    title: 'Safety & Compliance',
    subtitle: 'SMS incidents, risk register, audits, and corrective actions.',
    href: '/safety',
    apiPrefix: '/api/safety'
  },
  'live-flights': {
    id: 'live-flights',
    title: 'Live Flight Tracking',
    subtitle: 'Movement board, phase tracking, OTP, and fleet rotation chain.',
    href: '/live-flights',
    apiPrefix: '/api/operations/occ'
  },
  operations: {
    id: 'operations',
    title: 'Flight Operations',
    subtitle: 'Schedule, flight control, and day-of-ops board.',
    href: '/operations',
    apiPrefix: '/api/operations'
  },
  maintenance: {
    id: 'maintenance',
    title: 'Aircraft Maintenance',
    subtitle: 'MEL/CDL, defects, AOG, inspections, and serviceability.',
    href: '/maintenance',
    apiPrefix: '/api/maintenance'
  },
  commercial: {
    id: 'commercial',
    title: 'Commercial Core',
    subtitle: 'Booking, PNR, e-tickets, and commercial integrations.',
    href: '/commercial',
    apiPrefix: '/api/commercial'
  },
  'passenger-services': {
    id: 'passenger-services',
    title: 'Passenger Services',
    subtitle: 'Disruptions, complaints, SSR, VIP, and passenger history.',
    href: '/customer-service',
    apiPrefix: '/api/customer-service',
    legacyHref: '/customers'
  }
};
