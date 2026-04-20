export type UserRole = 'DOCTOR' | 'RECEPTIONIST' | 'PHARMACIST';

export const roleModules: Record<UserRole, string[]> = {
  DOCTOR: ['users', 'patients', 'prescriptions', 'inventory', 'payments', 'reports', 'audit-logs'],
  RECEPTIONIST: ['patients', 'payments', 'sales', 'reports'],
  PHARMACIST: ['patients', 'sales', 'prescriptions', 'inventory', 'reports'],
};

export const roleBasePath: Record<UserRole, string> = {
  DOCTOR: '/doctor',
  RECEPTIONIST: '/receptionist',
  PHARMACIST: '/pharmacist',
};
