export type UserRole = 'DOCTOR' | 'RECEPTIONIST' | 'PHARMACIST';

export const roleModules: Record<UserRole, string[]> = {
  DOCTOR: ['users', 'patients', 'appointments', 'prescriptions', 'inventory', 'payments', 'reports', 'audit-logs'],
  RECEPTIONIST: ['patients', 'appointments', 'payments', 'sales', 'reports'],
  PHARMACIST: ['patients', 'sales', 'prescriptions', 'inventory', 'reports'],
};

export const roleBasePath: Record<UserRole, string> = {
  DOCTOR: '/doctor',
  RECEPTIONIST: '/receptionist',
  PHARMACIST: '/pharmacist',
};
