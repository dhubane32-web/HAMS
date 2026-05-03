import { userHasAnyRole } from './roles.js';

/** Which roles may call each report endpoint (super_admin inherits admin where listed). */
export const REPORT_ACCESS = {
  'daily-sales': ['admin', 'finance', 'sales_manager', 'agent'],
  bookings: ['admin', 'finance', 'sales_manager', 'agent'],
  tickets: ['admin', 'finance', 'sales_manager', 'agent'],
  passengers: ['admin', 'finance', 'sales_manager', 'agent'],
  revenue: ['admin', 'finance', 'sales_manager', 'agent'],
  'agent-sales': ['admin', 'finance', 'sales_manager', 'agent'],
  refunds: ['admin', 'finance', 'sales_manager', 'agent'],
  expenses: ['admin', 'finance'],
  'flight-performance': ['admin', 'finance', 'sales_manager', 'operations', 'maintenance'],
  'route-performance': ['admin', 'finance', 'sales_manager', 'operations', 'maintenance'],
  checkins: ['admin', 'finance', 'sales_manager', 'operations', 'customer_service'],
  'crew-utilization': ['admin', 'operations'],
  'aircraft-utilization': ['admin', 'operations', 'maintenance'],
  'customer-service': ['admin', 'finance', 'customer_service'],
  meta: ['admin', 'finance', 'sales_manager', 'agent', 'operations', 'maintenance', 'customer_service'],
  kpis: ['admin', 'finance', 'sales_manager', 'agent', 'operations', 'maintenance', 'customer_service']
};

export function canAccessReport(role, reportKey) {
  const allowed = REPORT_ACCESS[reportKey];
  if (!allowed) return false;
  return userHasAnyRole(role, allowed);
}

export function isAgentOnlySales(role) {
  return role === 'agent';
}

export function canFilterByAgent(role) {
  return userHasAnyRole(role, ['admin', 'super_admin', 'finance', 'sales_manager']);
}
