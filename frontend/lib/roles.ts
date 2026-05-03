export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'finance'
  | 'operations'
  | 'agent'
  | 'booking_agent'
  | 'checkin_agent'
  | 'crew'
  | 'maintenance'
  | 'customer_service'
  | 'sales_manager';

export const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  finance: 'Finance User',
  operations: 'Operations User',
  agent: 'Agent (multi-desk)',
  booking_agent: 'Booking Agent',
  checkin_agent: 'Check-in Agent',
  crew: 'Crew Member',
  maintenance: 'Maintenance Engineer',
  customer_service: 'Customer Service',
  sales_manager: 'Sales & Marketing'
};

export function roleDisplayName(role: string | null | undefined): string {
  if (!role) return 'User';
  if (role in roleLabels) return roleLabels[role as UserRole];
  return role;
}
