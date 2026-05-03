export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'finance'
  | 'operations'
  | 'agent'
  | 'crew'
  | 'maintenance'
  | 'customer_service'
  | 'sales_manager';

export const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  finance: 'Finance',
  operations: 'Operations',
  agent: 'Agent',
  crew: 'Crew',
  maintenance: 'Maintenance',
  customer_service: 'Customer Service',
  sales_manager: 'Sales Manager'
};

export function roleDisplayName(role: string | null | undefined): string {
  if (!role) return 'User';
  if (role in roleLabels) return roleLabels[role as UserRole];
  return role;
}
