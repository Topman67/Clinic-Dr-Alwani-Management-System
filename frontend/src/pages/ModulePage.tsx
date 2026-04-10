import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

const titles: Record<string, string> = {
  users: 'Manage User Account',
  patients: 'Manage Patient',
  prescriptions: 'Manage Prescription',
  inventory: 'Manage Inventory',
  payments: 'Manage Payment',
  reports: 'Generate Report',
  'audit-logs': 'Audit Logs',
};

export const ModulePage = () => {
  const location = useLocation();

  const slug = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts[2] || 'dashboard';
  }, [location.pathname]);

  return (
    <section className="card">
      <h1>{titles[slug] ?? 'Module'}</h1>
      <p>This module shell is ready for CRUD integration with backend endpoints.</p>
      <p className="muted">Current route: {location.pathname}</p>
    </section>
  );
};
