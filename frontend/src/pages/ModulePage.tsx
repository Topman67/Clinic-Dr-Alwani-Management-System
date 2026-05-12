import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Card } from '../components/ui';
import { ui } from '../styles/ui';

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
    <Card>
      <h1 className={ui.sectionTitle}>{titles[slug] ?? 'Module'}</h1>
      <p>This module shell is ready for CRUD integration with backend endpoints.</p>
      <p className={ui.muted}>Current route: {location.pathname}</p>
    </Card>
  );
};
